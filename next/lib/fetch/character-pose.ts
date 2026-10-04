import * as THREE from "three";
import type { CharacterProfile } from "../lifelike/controller";

export type FetchPosePhase = "pickup" | "carry" | "offer";
type Joint = {
  bone: THREE.Bone; rest: THREE.Quaternion;
  rotation: THREE.Quaternion; position: THREE.Vector3; scale: THREE.Vector3;
};
type Leg = { hip: Joint; knee: Joint; foot: Joint; position: THREE.Vector3; rotation: THREE.Quaternion };
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (value: number) => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Fetch poses layer over the shipped locomotion clips. Restore before the mixer
 * samples, then apply afterwards. Only this layer's saved transforms are restored;
 * the actor remains owned by navigation. Socket coordinates are calibrated in the
 * source meshes and converted into the actual bone space, including Tripo's bind
 * rotations. Changing the viewer's model scale afterwards is supported.
 */
export class FetchCharacterPose {
  readonly holdingPart: "hand" | "mouth";
  private readonly root: THREE.Object3D;
  private readonly profile: CharacterProfile;
  private readonly ballRadius: number;
  private readonly joints = new Map<string, Joint>();
  private readonly legs: Leg[] = [];
  private readonly holder: THREE.Object3D;
  private readonly contact = new THREE.Vector3();
  private readonly outward = new THREE.Vector3();
  private readonly forward: THREE.Vector3;
  private readonly right = new THREE.Vector3();
  private readonly worldForward = new THREE.Vector3();
  private readonly rootRotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly rotation = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly worldScale = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly pickup = new THREE.Vector3();
  private readonly wristTarget = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly ikHip = new THREE.Vector3();
  private readonly ikKnee = new THREE.Vector3();
  private readonly ikEnd = new THREE.Vector3();
  private readonly ikDirection = new THREE.Vector3();
  private readonly ikBend = new THREE.Vector3();
  private readonly ikTarget = new THREE.Vector3();
  private readonly alignPivot = new THREE.Vector3();
  private readonly alignCurrent = new THREE.Vector3();
  private readonly alignDesired = new THREE.Vector3();
  private applied = false;

  constructor(root: THREE.Object3D, profile: CharacterProfile, ballRadius = 0.09) {
    this.root = root; this.profile = profile;
    this.ballRadius = Number.isFinite(ballRadius) ? Math.max(0, ballRadius) : 0.09;
    this.holdingPart = profile.kind === "human" ? "hand" : "mouth";
    this.forward = new THREE.Vector3(Math.sin(profile.forwardYaw), 0, Math.cos(profile.forwardYaw));
    this.right.crossVectors(UP, this.forward);
    const bones = new Map<string, THREE.Bone>();
    root.traverse(object => {
      if (object instanceof THREE.Bone) bones.set(THREE.PropertyBinding.sanitizeNodeName(object.name), object);
    });
    const add = (key: string, ...names: string[]) => {
      const bone = names.map(name => bones.get(THREE.PropertyBinding.sanitizeNodeName(name))).find(Boolean);
      if (!bone) return undefined;
      const joint = { bone, rest: bone.quaternion.clone(), rotation: bone.quaternion.clone(),
        position: bone.position.clone(), scale: bone.scale.clone() };
      this.joints.set(key, joint);
      return joint;
    };
    if (profile.kind === "human") {
      add("root", "Root"); add("waist", "Waist"); add("neck", "Neck");
      add("armL", "L_Upperarm"); add("arm", "R_Upperarm"); add("elbow", "R_Forearm"); add("hand", "R_Hand");
      for (const side of ["L", "R"]) {
        const hip = add(`${side}Hip`, `${side}_Thigh`), knee = add(`${side}Knee`, `${side}_Calf`), foot = add(`${side}Foot`, `${side}_Foot`);
        if (hip && knee && foot) this.legs.push({ hip, knee, foot, position: new THREE.Vector3(), rotation: new THREE.Quaternion() });
      }
    } else if (profile.kind === "dog") {
      add("neck", "tripo::Head_0"); add("head", "tripo::Head_1");
    } else {
      // Chest is safe for Pikachu: its legs are siblings, not descendants.
      const chest = bones.get("Chest");
      let carriesLegs = false;
      chest?.traverse(child => { if (/foot|toe|limb|calf|thigh|leg/i.test(child.name)) carriesLegs = true; });
      if (!carriesLegs) add("chest", "Chest");
      add("head", "Head"); add("armL", "Arm.L"); add("armR", "Arm.R");
    }
    this.holder = this.joints.get(profile.kind === "human" ? "hand" : "head")?.bone ?? root;
    root.updateWorldMatrix(true, true);
    // Surface landmarks, in source-model coordinates. A small radius offset is
    // applied in world units by socket(), keeping differently sized pets usable.
    if (profile.kind === "human" && this.holder !== root) {
      this.contact.set(0.006, -0.028, 0);
      this.outward.copy(this.forward).applyQuaternion(root.getWorldQuaternion(this.rootRotation))
        .applyQuaternion(this.holder.getWorldQuaternion(this.rotation).invert()).normalize();
    } else {
      if (profile.kind === "dog") this.contact.set(0.476, 0.475, -0.005);
      else if (profile.kind === "pikachu") this.contact.set(0, 0.205, 0.752);
      else this.contact.set(0, 0.5, 0.2);
      this.holder.worldToLocal(root.localToWorld(this.contact));
      this.outward.copy(this.forward).applyQuaternion(root.getWorldQuaternion(this.rootRotation))
        .applyQuaternion(this.holder.getWorldQuaternion(this.rotation).invert()).normalize();
    }
  }

  /** World-space center of the carried ball, attached to the actual hand/mouth. */
  socket(target: THREE.Vector3): THREE.Vector3 {
    this.holder.updateWorldMatrix(true, false);
    target.copy(this.contact).applyMatrix4(this.holder.matrixWorld);
    this.offset.copy(this.outward).transformDirection(this.holder.matrixWorld);
    return target.addScaledVector(this.offset, this.ballRadius * 0.65);
  }

  /** Horizontal navigation reach in world units, recomputed after model scaling. */
  pickupReach(): number {
    this.root.getWorldScale(this.worldScale);
    const reach = this.profile.kind === "human" ? 0.28 : this.profile.kind === "pikachu" ? 0.74 : 0.37;
    return Math.max(0.15, reach * Math.max(Math.abs(this.worldScale.x), Math.abs(this.worldScale.z)));
  }

  restore(): void {
    if (!this.applied) return;
    for (const joint of this.joints.values()) {
      joint.bone.quaternion.copy(joint.rotation); joint.bone.position.copy(joint.position); joint.bone.scale.copy(joint.scale);
    }
    this.applied = false;
  }

  reset(): void { this.restore(); }

  private rotate(key: string, radians: number, sourceAxis = this.right): void {
    const joint = this.joints.get(key);
    if (!joint || Math.abs(radians) < 1e-8) return;
    joint.bone.parent?.getWorldQuaternion(this.parentRotation);
    if (!joint.bone.parent) this.parentRotation.identity();
    this.parentRotation.invert();
    this.axis.copy(sourceAxis).applyQuaternion(this.rootRotation).applyQuaternion(this.parentRotation).normalize();
    joint.bone.quaternion.premultiply(this.turn.setFromAxisAngle(this.axis, radians)).normalize();
    joint.bone.updateWorldMatrix(false, true);
  }

  private align(joint: THREE.Bone, end: THREE.Bone, target: THREE.Vector3): void {
    joint.getWorldPosition(this.alignPivot);
    end.getWorldPosition(this.alignCurrent).sub(this.alignPivot).normalize();
    this.alignDesired.copy(target).sub(this.alignPivot).normalize();
    if (this.alignDesired.lengthSq() < 0.5 || this.alignCurrent.lengthSq() < 0.5) return;
    this.turn.setFromUnitVectors(this.alignCurrent, this.alignDesired);
    joint.getWorldQuaternion(this.rotation).premultiply(this.turn);
    if (joint.parent) this.rotation.premultiply(joint.parent.getWorldQuaternion(this.parentRotation).invert());
    joint.quaternion.copy(this.rotation).normalize();
    joint.updateWorldMatrix(false, true);
  }

  private solve(hip: THREE.Bone, knee: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3): void {
    hip.getWorldPosition(this.ikHip); knee.getWorldPosition(this.ikKnee); end.getWorldPosition(this.ikEnd);
    const upper = this.ikHip.distanceTo(this.ikKnee), lower = this.ikKnee.distanceTo(this.ikEnd);
    if (upper < 1e-6 || lower < 1e-6) return;
    this.ikDirection.copy(target).sub(this.ikHip);
    const distance = THREE.MathUtils.clamp(this.ikDirection.length(), Math.abs(upper - lower) + 1e-6, upper + lower - 1e-6);
    if (this.ikDirection.lengthSq() < 1e-12) this.ikDirection.copy(UP);
    else this.ikDirection.normalize();
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    this.ikBend.copy(pole).addScaledVector(this.ikDirection, -pole.dot(this.ikDirection));
    if (this.ikBend.lengthSq() < 1e-8) this.ikBend.copy(this.right).applyQuaternion(this.rootRotation)
      .addScaledVector(this.ikDirection, -this.ikBend.dot(this.ikDirection));
    this.ikBend.normalize();
    this.ikTarget.copy(this.ikHip).addScaledVector(this.ikDirection, along).addScaledVector(this.ikBend, height);
    this.align(hip, knee, this.ikTarget); this.align(knee, end, target);
  }

  /** Pickup reaches down at .5 and finishes in carry; offer progress is its blend. */
  apply(phase: FetchPosePhase, progress: number, deltaSeconds: number, target?: THREE.Vector3): void {
    this.restore();
    if (!Number.isFinite(progress) || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const dip = phase === "pickup" ? smooth(p / 0.45) * (1 - smooth((p - 0.55) / 0.45)) : 0;
    const amount = phase === "pickup" ? smooth(p / 0.18) : 1;
    const offer = phase === "offer" ? smooth(p) : 0;
    if (amount === 0 || this.joints.size === 0) return;
    this.root.updateWorldMatrix(true, true); this.root.getWorldQuaternion(this.rootRotation);
    this.worldForward.copy(this.forward).applyQuaternion(this.rootRotation);
    for (const joint of this.joints.values()) {
      joint.rotation.copy(joint.bone.quaternion); joint.position.copy(joint.bone.position); joint.scale.copy(joint.bone.scale);
    }
    this.applied = true;
    if (this.profile.kind === "human") this.humanPose(dip, amount, offer, target);
    else this.creaturePose(dip, amount, offer);
  }

  private humanPose(dip: number, amount: number, offer: number, target?: THREE.Vector3): void {
    for (const leg of this.legs) {
      leg.foot.bone.getWorldPosition(leg.position); leg.foot.bone.getWorldQuaternion(leg.rotation);
    }
    // A deep squat supplies enough reach for a floor pickup; the two-bone leg
    // solution preserves both planted feet and toe directions exactly.
    const root = this.joints.get("root");
    if (root && this.legs.length === 2) root.bone.position.y -= 0.23 * dip;
    this.root.updateWorldMatrix(true, true);
    this.rotate("waist", 1.67 * dip); this.rotate("neck", -0.48 * dip);
    this.rotate("armL", -0.5 * dip);
    for (const leg of this.legs) {
      this.solve(leg.hip.bone, leg.knee.bone, leg.foot.bone, leg.position, this.worldForward);
      leg.foot.bone.quaternion.copy(leg.foot.bone.parent!.getWorldQuaternion(this.parentRotation).invert().multiply(leg.rotation));
      leg.foot.bone.updateWorldMatrix(false, true);
    }
    const arm = this.joints.get("arm"), elbow = this.joints.get("elbow"), hand = this.joints.get("hand");
    if (!arm || !elbow || !hand) return;
    for (const joint of [arm, elbow, hand]) joint.bone.quaternion.slerp(joint.rest, amount);
    this.root.updateWorldMatrix(true, true);
    // Carry beside the chest; extend toward the visitor when offering it back.
    this.desired.set(0.20 + offer * 0.11, 0.12 + offer * 0.08, 0.115 - offer * 0.055);
    this.root.localToWorld(this.desired);
    this.pickup.set(0.29, -0.44, 0.035); this.root.localToWorld(this.pickup);
    if (target && [target.x, target.y, target.z].every(Number.isFinite)) this.pickup.copy(target);
    this.desired.lerp(this.pickup, dip);
    this.socket(this.point); this.desired.lerpVectors(this.point, this.desired, amount);
    // Account for the palm offset, rather than placing the wrist at ball center.
    // Re-solving after the hand changes direction converges without stretching.
    for (let iteration = 0; iteration < 3; iteration++) {
      hand.bone.getWorldPosition(this.wristTarget); this.socket(this.point);
      this.wristTarget.add(this.desired).sub(this.point);
      this.axis.copy(this.right).applyQuaternion(this.rootRotation).negate();
      this.solve(arm.bone, elbow.bone, hand.bone, this.wristTarget, this.axis);
    }
  }

  private creaturePose(dip: number, amount: number, offer: number): void {
    if (this.profile.kind === "dog") {
      this.rotate("neck", 1.48 * dip - 0.10 * amount - 0.12 * offer);
      this.rotate("head", -0.12 * dip);
    } else {
      this.rotate("chest", 1.62 * dip - 0.06 * offer);
      const chest = this.joints.get("chest");
      if (chest) chest.bone.position.y -= 0.24 * dip;
      this.rotate("head", -0.22 * dip - 0.04 * amount - 0.08 * offer);
      this.rotate("armL", -0.25 * dip); this.rotate("armR", -0.25 * dip);
    }
    this.root.updateWorldMatrix(true, true);
  }
}
