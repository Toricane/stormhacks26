import * as THREE from "three";

type Profile = { kind: "human" | "dog" | "pikachu" | "generic"; forwardYaw: number };
type Role = "chest" | "neck" | "head" | "armL" | "armR" | "earL" | "earR" | "tipL" | "tipR" | "tail";
type Joint = {
  bone: THREE.Bone; role: Role;
  restRotation: THREE.Quaternion; restScale: THREE.Vector3; restPosition: THREE.Vector3;
  rotation: THREE.Quaternion; scale: THREE.Vector3; position: THREE.Vector3;
};
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const radians = THREE.MathUtils.degToRad;

/**
 * A small idle layer with separate breathing, posture and attention clocks.
 * Call restore() BEFORE the animation mixer, then update() AFTER it. Keeping
 * the unmodified mixer pose avoids drift even on joints absent from a clip.
 */
export class IdleMotion {
  private readonly root: THREE.Object3D;
  private readonly profile: Profile;
  private readonly random: () => number;
  private readonly joints: Joint[] = [];
  private readonly forward: THREE.Vector3;
  private readonly right = new THREE.Vector3();
  private readonly pitchAxis = new THREE.Vector3();
  private readonly rootRotation = new THREE.Quaternion();
  private readonly inverseRootRotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private applied = false;
  private weight = 0;
  private breathPhase = 0;
  private breathPeriod = 4;
  private breathStrength = 1;
  private nextAttention = -Infinity;
  private nextPosture = -Infinity;
  private glanceYaw = 0;
  private glancePitch = 0;
  private glanceRoll = 0;
  private lookingAtVisitor = true;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private postureTarget = 0;
  private posture = 0;
  private nextEar = -Infinity;
  private earStart = -Infinity;
  private earSide = 1;
  private seconds = 0;

  constructor(root: THREE.Object3D, profile: Profile, random: () => number = Math.random) {
    this.root = root; this.profile = profile; this.random = random;
    this.forward = new THREE.Vector3(Math.sin(profile.forwardYaw), 0, Math.cos(profile.forwardYaw));
    this.right.crossVectors(UP, this.forward);
    this.pitchAxis.copy(this.right).negate();
    const bones = new Map<string, THREE.Bone>();
    // GLTFLoader removes punctuation used by animation property paths (both
    // `tripo::Head_0` and `Ear.L`). Normalize source aliases the same way.
    const boneKey = THREE.PropertyBinding.sanitizeNodeName;
    root.traverse(object => {
      if (object instanceof THREE.Bone) bones.set(boneKey(object.name), object);
    });
    const add = (role: Role, ...names: string[]) => {
      const bone = names.map(name => bones.get(boneKey(name))).find(Boolean);
      if (!bone || this.joints.some(joint => joint.bone === bone)) return;
      // Never move a torso joint that also carries planted legs. In particular,
      // the dog's Spine_1 is the parent of both front legs, unlike human Chest.
      if (role === "chest") {
        let carriesFeet = false;
        bone.traverse(child => {
          if (child !== bone && /foot|toe|limb|calf|thigh|leg/i.test(child.name)) carriesFeet = true;
        });
        if (carriesFeet) return;
      }
      this.joints.push({ bone, role, restRotation: bone.quaternion.clone(), restScale: bone.scale.clone(),
        restPosition: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone(),
        position: bone.position.clone() });
    };
    add("chest", "Chest");
    add("neck", "Neck", "tripoHead_0");
    add("head", "Head", "tripoHead_1");
    add("armL", "L_Upperarm", "Arm.L"); add("armR", "R_Upperarm", "Arm.R");
    add("earL", "Ear.L"); add("earR", "Ear.R");
    add("tipL", "EarTip.L"); add("tipR", "EarTip.R");
    if (profile.kind === "dog") add("tail", "bone_20");
    this.reset();
  }

  /** Remove this frame's overlay before the mixer or a view change touches bones. */
  restore(): void {
    if (!this.applied) return;
    for (const joint of this.joints) {
      joint.bone.quaternion.copy(joint.rotation);
      joint.bone.scale.copy(joint.scale);
      joint.bone.position.copy(joint.position);
    }
    this.applied = false;
  }

  reset(): void {
    this.restore(); this.weight = 0; this.seconds = 0;
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.posture = 0; this.postureTarget = 0;
    this.nextAttention = -Infinity; this.nextPosture = -Infinity;
    this.nextEar = -Infinity; this.earStart = -Infinity;
    this.breathPhase = this.random() * TAU;
    this.chooseBreath();
  }

  private chooseBreath(): void {
    this.breathPeriod = this.profile.kind === "dog" ? 2.5 + this.random() * 1.3 : 3.2 + this.random() * 1.8;
    this.breathStrength = 0.8 + this.random() * 0.4;
  }

  private rotate(joint: Joint, pitch: number, yaw: number, roll: number): void {
    // Transform source-model axes through the actor and the joint's parent.
    // This works for +X-facing humans/dog, +Z-facing Pikachu, and rotated bind poses.
    if (joint.bone.parent) joint.bone.parent.getWorldQuaternion(this.parentRotation).invert();
    else this.parentRotation.identity();
    const apply = (sourceAxis: THREE.Vector3, angle: number) => {
      if (Math.abs(angle) < 1e-8) return;
      this.axis.copy(sourceAxis).applyQuaternion(this.rootRotation).applyQuaternion(this.parentRotation);
      this.turn.setFromAxisAngle(this.axis, angle * this.weight);
      joint.bone.quaternion.premultiply(this.turn);
    };
    apply(this.pitchAxis, pitch); apply(UP, yaw); apply(this.forward, roll);
    joint.bone.quaternion.normalize();
  }

  /** idleWeight is 1 for ordinary idle and 0 during an authored action/walk. */
  update(delta: number, nowMs: number, idleWeight: number, attentionTarget?: THREE.Vector3): void {
    // Also make repeated update() calls without a mixer harmless.
    this.restore();
    const dt = Number.isFinite(delta) ? THREE.MathUtils.clamp(delta, 0, 0.1) : 0;
    if (!Number.isFinite(nowMs) || dt === 0) return;
    const goal = Number.isFinite(idleWeight) ? THREE.MathUtils.clamp(idleWeight, 0, 1) : 0;
    this.weight += (goal - this.weight) * (1 - Math.exp(-dt * (goal > this.weight ? 3 : 9)));
    this.seconds += dt;
    this.breathPhase += dt / this.breathPeriod * TAU;
    if (this.breathPhase >= TAU) { this.breathPhase %= TAU; this.chooseBreath(); }

    if (nowMs >= this.nextAttention) {
      this.lookingAtVisitor = this.random() < 0.65;
      this.glanceYaw = radians((this.random() - 0.5) * (this.lookingAtVisitor ? 7 : 26));
      this.glancePitch = radians((this.random() - 0.5) * 9);
      this.glanceRoll = radians((this.random() - 0.5) * (this.profile.kind === "human" ? 4 : 9));
      this.nextAttention = nowMs + 1600 + this.random() * 3100;
    }
    if (nowMs >= this.nextPosture) {
      this.postureTarget = this.random() * 2 - 1;
      this.nextPosture = nowMs + 3300 + this.random() * 4700;
    }
    if (nowMs >= this.nextEar) {
      this.earStart = nowMs; this.earSide = this.random() < 0.5 ? -1 : 1;
      this.nextEar = nowMs + 3200 + this.random() * 5100;
    }
    this.root.getWorldQuaternion(this.rootRotation);
    this.inverseRootRotation.copy(this.rootRotation).invert();
    let targetYaw = this.glanceYaw, targetPitch = this.glancePitch;
    const head = this.joints.find(joint => joint.role === "head")?.bone;
    if (attentionTarget && head && this.lookingAtVisitor) {
      head.getWorldPosition(this.origin);
      this.direction.copy(attentionTarget).sub(this.origin).applyQuaternion(this.inverseRootRotation);
      const horizontal = Math.hypot(this.direction.x, this.direction.z);
      if (horizontal > 0.05) {
        targetYaw += THREE.MathUtils.clamp(Math.atan2(this.direction.dot(this.right), this.direction.dot(this.forward)), -0.4, 0.4);
        targetPitch += THREE.MathUtils.clamp(Math.atan2(this.direction.y, horizontal), -0.22, this.profile.kind === "human" ? 0.22 : 0.36);
      }
    }
    const gazeEase = 1 - Math.exp(-dt * 3.5);
    this.yaw += (targetYaw - this.yaw) * gazeEase;
    this.pitch += (targetPitch - this.pitch) * gazeEase;
    this.roll += (this.glanceRoll - this.roll) * (1 - Math.exp(-dt * 2));
    this.posture += (this.postureTarget - this.posture) * (1 - Math.exp(-dt * 0.75));
    if (this.weight < 0.0001) return;

    const breath = (0.5 - 0.5 * Math.cos(this.breathPhase)) * this.breathStrength;
    const settle = this.posture * radians(1.6);
    const earTime = (nowMs - this.earStart) / 620;
    const earFlick = earTime >= 0 && earTime < 1 ? Math.sin(Math.PI * earTime) ** 2 : 0;
    const hasNeck = this.joints.some(joint => joint.role === "neck");
    // Save ALL base poses before editing a parent, so restore is exact.
    for (const joint of this.joints) {
      joint.rotation.copy(joint.bone.quaternion); joint.scale.copy(joint.bone.scale); joint.position.copy(joint.bone.position);
      // Break the metronomic baked idle rhythm on these upper-body joints.
      // During a reaction this influence quickly fades with the overlay.
      joint.bone.quaternion.slerp(joint.restRotation, this.weight * 0.85);
      joint.bone.scale.lerp(joint.restScale, this.weight * 0.85);
      joint.bone.position.lerp(joint.restPosition, this.weight * 0.85);
    }
    this.applied = true;
    for (const joint of this.joints) {
      switch (joint.role) {
        case "chest":
          this.rotate(joint, radians(0.55) * breath, settle * 0.4, settle);
          joint.bone.scale.multiplyScalar(1 + breath * this.weight * (this.profile.kind === "human" ? 0.004 : 0.006));
          break;
        case "neck":
          this.rotate(joint, this.pitch * 0.65 + radians(0.35) * breath, this.yaw * 0.65, this.roll * 0.4 - settle * 0.4);
          break;
        case "head":
          this.rotate(joint, this.pitch * (hasNeck ? 0.35 : 1), this.yaw * (hasNeck ? 0.35 : 1), this.roll * (hasNeck ? 0.6 : 1));
          break;
        case "armL": this.rotate(joint, settle * 0.45 + radians(0.3) * breath, 0, -settle * 0.3); break;
        case "armR": this.rotate(joint, -settle * 0.3 - radians(0.25) * breath, 0, -settle * 0.4); break;
        case "earL": this.rotate(joint, -radians(5) * earFlick * (this.earSide < 0 ? 1 : 0.2), 0, this.roll * 0.25); break;
        case "earR": this.rotate(joint, -radians(5) * earFlick * (this.earSide > 0 ? 1 : 0.2), 0, -this.roll * 0.2); break;
        case "tipL": this.rotate(joint, radians(2) * earFlick, 0, radians(0.7) * breath); break;
        case "tipR": this.rotate(joint, radians(1.4) * earFlick, 0, -radians(0.5) * breath); break;
        case "tail":
          this.rotate(joint, 0, radians(3) * Math.sin(this.seconds * 1.7 + this.posture) + settle, 0);
          break;
      }
    }
  }
}
