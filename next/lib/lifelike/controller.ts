import * as THREE from "three";
import type { CharacterAnimationPlayer, CharacterAnimation } from "../character-animation-player";
import type { Hand } from "../hands/types";
import type { Viewport } from "../hands/handSystem";
import { HandGestures, handLength, raisedPalm, openPalm } from "./hand-gestures.ts";
import { IdleMotion } from "./idle-motion.ts";
import { PLAYER_RADIUS, type CollisionWorld } from "../environments/collision-world.ts";

const HAND_REST_DISTANCE = 0.8;
const HAND_REACH_GAIN = 4;
const HAND_MIN_DISTANCE = 0.25;
const HAND_MAX_DISTANCE = 2.2;
const TOUCH_GRACE_MS = 500;
const PET_MIN_SPEED = 0.28;
const TOUCH_DEPTH_TOLERANCE = 0.22;
const MAX_SAMPLE_AGE_MS = 220;
const WALK_SPEED = 0.65;
const HUMAN_STOP_DISTANCE = 0.95;
const CREATURE_STOP_DISTANCE = 0.8;
const HIGH_FIVE_COOLDOWN_MS = 3500;
const IDLE_MIN_MS = 6000;
const IDLE_RANGE_MS = 5000;
const WANDER_RADIUS = 1.1;
const WANDER_SPEED = 0.35;

export type HandFrame = { hands: Hand[]; viewport: Viewport; sampleTime: number };
export type CharacterProfile = { kind: "human" | "dog" | "pikachu" | "generic"; name: string; forwardYaw: number };
type Activity = "idle" | "wave" | "approach" | "wander" | "pet" | "afterPet" | "highFive" | "idleAction";
const ACTIVITY_LABELS: Record<Activity, string> = { idle: "Idle", idleAction: "Looking around", wave: "Waving back",
  approach: "Walking over", wander: "Strolling nearby", pet: "Enjoying a pet", afterPet: "Happy", highFive: "Offering a high five" };
const IDLE_LABELS: Record<string, string> = { Curious: "Curious", Drowsy: "Drowsy", Shrug: "Shrugging", Sniff: "Sniffing", "Play bow": "Play bow" };
type Options = {
  actor: THREE.Group; root: THREE.Object3D; camera: THREE.PerspectiveCamera;
  player: CharacterAnimationPlayer; animations: CharacterAnimation[]; profile: CharacterProfile;
  random?: () => number;
};

export function characterProfile(assetName: string, bones: THREE.Bone[]): CharacterProfile {
  if (/lebron/i.test(assetName)) return { kind: "human", name: "LeBron", forwardYaw: Math.PI / 2 };
  if (/keanu/i.test(assetName)) return { kind: "human", name: "Keanu", forwardYaw: Math.PI / 2 };
  if (/pikachu/i.test(assetName) || bones.some(bone => ["EarTip.L", "EarTipL"].includes(bone.name))) return { kind: "pikachu", name: "Pikachu", forwardYaw: 0 };
  if (/dog/i.test(assetName) || bones.some(bone => /tripo.*Head_/.test(bone.name))) return { kind: "dog", name: "Dog", forwardYaw: Math.PI / 2 };
  if (bones.some(bone => bone.name === "R_Hand")) return { kind: "human", name: "Character", forwardYaw: Math.PI / 2 };
  return { kind: "generic", name: "Character", forwardYaw: 0 };
}

/** Owns reactions and world movement only while the Lifelike view is active. */
export class LifelikeController {
  private readonly actor: THREE.Group;
  private readonly root: THREE.Object3D;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly player: CharacterAnimationPlayer;
  private readonly clips: Map<string, CharacterAnimation>;
  private readonly profile: CharacterProfile;
  private readonly random: () => number;
  private readonly gestures = new HandGestures();
  private readonly idleMotion: IdleMotion;
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly bounds = new THREE.Box3();
  private readonly dimensions = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly body = new THREE.Vector3();
  private readonly highFiveTarget = new THREE.Vector3();
  private readonly palm = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly projection = new THREE.Vector3();
  private readonly ray = new THREE.Vector3();
  private readonly touchPoint = new THREE.Vector3();
  private readonly cameraAngles = new THREE.Euler(0, 0, 0, "YXZ");
  private activity: Activity = "idle";
  private clip = "";
  private until = 0;
  private clipElapsed = 0;
  private nextIdle = 0;
  private lastSample = -1;
  private lastHighFive = -Infinity;
  private highFiveContact = false;
  private highFiveArmed = true;
  private active = false;
  private readonly approachTarget = new THREE.Vector3();
  private readonly home = new THREE.Vector3();
  private readonly wanderTarget = new THREE.Vector3();
  private moveSpeed = 0;
  private lastIdleClip = "";
  private world: CollisionWorld | null = null;
  private bodyRadius = 0.35;
  private route: THREE.Vector3[] = [];
  private routeAt = -Infinity;
  private readonly routeDestination = new THREE.Vector3();
  private readonly movementHeading = new THREE.Vector3();

  constructor(options: Options) {
    this.actor = options.actor; this.root = options.root; this.camera = options.camera;
    this.player = options.player; this.profile = options.profile;
    this.clips = new Map(options.animations.map(clip => [clip.name, clip]));
    this.random = options.random ?? Math.random;
    this.root.traverse(object => { if (object instanceof THREE.Bone) this.bones.set(object.name, object); });
    this.idleMotion = new IdleMotion(this.root, this.profile);
  }

  activate(nowMs: number): void {
    this.idleMotion.reset();
    this.active = true; this.gestures.reset(); this.lastSample = -1; this.moveSpeed = 0;
    this.lastHighFive = -Infinity; this.highFiveContact = false;
    this.highFiveArmed = true; this.dimensions.set(0, 0, 0);
    this.home.copy(this.actor.position);
    this.route = []; this.routeAt = -Infinity;
    this.clip = ""; this.player.setPlayback(true, 1);
    this.face(this.camera.position, 10);
    this.idle(nowMs);
  }

  deactivate(): void {
    this.idleMotion.reset();
    this.active = false; this.gestures.reset(); this.player.stop(); this.clip = "";
  }

  /** Remove last frame's additive pose before the animation mixer samples. */
  beforeAnimationUpdate(): void { this.idleMotion.restore(); }

  setWorld(world: CollisionWorld, bodyRadius: number): void {
    this.world = world; this.bodyRadius = bodyRadius; this.route = []; this.routeAt = -Infinity;
  }

  private moveActor(displacement: THREE.Vector3): number {
    if (this.world) return this.world.move(this.actor.position, displacement, this.bodyRadius,
      { position: this.camera.position, radius: PLAYER_RADIUS });
    this.actor.position.add(displacement); this.actor.position.y = 0;
    return displacement.length();
  }

  private navigationTarget(destination: THREE.Vector3, nowMs: number): THREE.Vector3 | null {
    if (!this.world) return destination;
    if (nowMs - this.routeAt > 650 && (this.route.length === 0 || this.routeDestination.distanceToSquared(destination) > .09)) {
      this.route = this.world.path(this.actor.position, destination, this.bodyRadius);
      this.routeAt = nowMs; this.routeDestination.copy(destination);
    }
    while (this.route.length && Math.hypot(this.route[0].x - this.actor.position.x, this.route[0].z - this.actor.position.z) < .1) this.route.shift();
    return this.route[0] ?? null;
  }

  private play(names: string[], activity: Activity, nowMs: number, holdMs?: number, replay = false): boolean {
    const name = names.find(candidate => this.clips.has(candidate));
    if (!name) return false;
    if (replay || this.clip !== name || this.activity !== activity) { this.player.play(name); this.clipElapsed = 0; }
    this.clip = name; this.activity = activity;
    this.until = nowMs + (holdMs ?? this.clips.get(name)!.duration * 1000);
    return true;
  }

  private idle(nowMs: number): void {
    if (!this.play(["Idle", "idle"], "idle", nowMs, Infinity)) {
      this.player.stop(); this.activity = "idle"; this.clip = "";
    }
    this.nextIdle = nowMs + IDLE_MIN_MS + this.random() * IDLE_RANGE_MS;
    this.moveSpeed = 0;
  }

  private afterPet(nowMs: number): void {
    const names = this.profile.kind === "pikachu" ? ["Happy"] : this.profile.kind === "dog" ? ["Tail wag"] : [];
    if (!this.play(names, "afterPet", nowMs)) this.idle(nowMs);
  }

  private anchors(): void {
    this.actor.updateMatrixWorld(true);
    // Use the normalized rest bounds only to size contact zones. Animated bones
    // supply their positions, so touch follows both locomotion and reactions.
    const head = this.bones.get("Head") ?? this.bones.get("tripoHead_1") ?? this.bones.get("tripo::Head_1");
    if (head) {
      head.getWorldPosition(this.head);
      // Pikachu's Head joint is at the base of its large skull. Other rigs
      // already place this joint near the center of their pettable surface.
      if (this.profile.kind === "pikachu") this.head.y += this.dimensions.y * 0.13;
    }
    else this.head.set(0, this.dimensions.y * 0.8, 0).add(this.actor.position);
    const chest = this.bones.get("Chest") ?? this.bones.get("Body") ?? this.bones.get("tripoSpine_1") ?? this.bones.get("tripo::Spine_1");
    if (chest) chest.getWorldPosition(this.body);
    else this.body.set(0, this.dimensions.y * 0.5, 0).add(this.actor.position);
  }

  private handPosition(hand: Hand, viewport: Viewport): THREE.Vector3 {
    const distance = THREE.MathUtils.clamp(HAND_REST_DISTANCE + hand.reach * HAND_REACH_GAIN, HAND_MIN_DISTANCE, HAND_MAX_DISTANCE);
    this.palm.set(hand.palm.x / viewport.width * 2 - 1, 1 - hand.palm.y / viewport.height * 2, 0.5).unproject(this.camera);
    return this.palm.sub(this.camera.position).normalize().multiplyScalar(distance).add(this.camera.position);
  }

  private touchesHead(hand: Hand, viewport: Viewport, radius: number): boolean {
    const reach = THREE.MathUtils.clamp(HAND_REST_DISTANCE + hand.reach * HAND_REACH_GAIN, HAND_MIN_DISTANCE, HAND_MAX_DISTANCE);
    // A short segment represents webcam depth uncertainty, not an infinite
    // screen-space ray. Distant characters still require walking closer.
    const probe = (x: number, y: number) => {
      if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return false;
      this.ray.set(x / viewport.width * 2 - 1, 1 - y / viewport.height * 2, 0.5)
        .unproject(this.camera).sub(this.camera.position).normalize();
      const distance = this.touchPoint.copy(this.head).sub(this.camera.position).dot(this.ray);
      if (distance <= 0) return false;
      const depth = THREE.MathUtils.clamp(distance, Math.max(HAND_MIN_DISTANCE, reach - TOUCH_DEPTH_TOLERANCE),
        Math.min(HAND_MAX_DISTANCE, reach + TOUCH_DEPTH_TOLERANCE));
      this.touchPoint.copy(this.ray).multiplyScalar(depth).add(this.camera.position);
      return this.touchPoint.distanceToSquared(this.head) < radius * radius;
    };
    if (probe(hand.palm.x, hand.palm.y)) return true;
    // The rendered glove includes fingertips. Stroking with those should count
    // even when the palm itself is above or beside the character's head.
    for (const i of [6, 8, 10, 12, 14, 16, 18, 20]) {
      if (probe(hand.points[i].x, hand.points[i].y)) return true;
    }
    return false;
  }

  private visible(): boolean {
    this.projection.copy(this.body).project(this.camera);
    return this.projection.z > -1 && this.projection.z < 1 && Math.abs(this.projection.x) < 1.15 && Math.abs(this.projection.y) < 1.15;
  }

  private face(point: THREE.Vector3, delta: number): void {
    const dx = point.x - this.actor.position.x, dz = point.z - this.actor.position.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    const desired = Math.atan2(dx, dz) - this.profile.forwardYaw;
    const difference = Math.atan2(Math.sin(desired - this.actor.rotation.y), Math.cos(desired - this.actor.rotation.y));
    this.actor.rotation.y += difference * (1 - Math.exp(-delta * 5));
  }

  private wander(nowMs: number): void {
    const angle = this.random() * Math.PI * 2;
    const radius = WANDER_RADIUS * (0.5 + this.random() * 0.5);
    this.wanderTarget.set(this.home.x + Math.cos(angle) * radius, 0, this.home.z + Math.sin(angle) * radius);
    const buffer = this.profile.kind === "human" ? HUMAN_STOP_DISTANCE : CREATURE_STOP_DISTANCE;
    if (Math.hypot(this.wanderTarget.x - this.camera.position.x, this.wanderTarget.z - this.camera.position.z) < buffer + 0.1) {
      this.target.copy(this.home).sub(this.camera.position).setY(0);
      if (this.target.lengthSq() < 0.001) this.target.set(1, 0, 0);
      this.wanderTarget.copy(this.target.normalize().multiplyScalar(WANDER_RADIUS)).add(this.home);
    }
    if (this.world) {
      const safe = this.world.nearest(this.wanderTarget, this.bodyRadius, .6);
      if (!safe || Math.hypot(safe.x - this.home.x, safe.z - this.home.z) > WANDER_RADIUS + .05) { this.nextIdle = nowMs + IDLE_MIN_MS; return; }
      this.wanderTarget.copy(safe);
    }
    this.route = []; this.routeAt = -Infinity;
    this.play(["Walk"], "wander", nowMs, 8000);
  }

  update(delta: number, nowMs: number, frame: HandFrame | null, followApproach = false): string {
    if (!this.active) return "";
    this.clipElapsed += Math.max(0, delta) * 1000;
    if (this.dimensions.lengthSq() === 0) {
      this.bounds.setFromObject(this.actor); this.bounds.getSize(this.dimensions);
    }
    this.camera.updateMatrixWorld(true); this.anchors();
    const hands = frame && nowMs - frame.sampleTime <= MAX_SAMPLE_AGE_MS ? frame.hands.filter(hand => !hand.stale) : [];
    const signals = frame && frame.sampleTime !== this.lastSample ? this.gestures.update(hands, frame.sampleTime) : [];
    if (frame) this.lastSample = frame.sampleTime;
    const human = this.profile.kind === "human";
    let contact = false;
    let touching = false;
    let offering = false;

    if (frame && frame.viewport.width > 0 && frame.viewport.height > 0) {
      const headRadius = human ? 0.22 : Math.max(0.16, Math.min(0.27, this.dimensions.y * 0.3));
      for (const hand of hands) {
        const palm = this.handPosition(hand, frame.viewport);
        const touchingHead = openPalm(hand) && this.touchesHead(hand, frame.viewport, headRadius);
        if (human && raisedPalm(hand)) {
          const shoulder = this.bones.get("R_Clavicle") ?? this.bones.get("R_Upperarm");
          if (shoulder) shoulder.getWorldPosition(this.highFiveTarget);
          else this.highFiveTarget.copy(this.head);
          this.highFiveTarget.y = this.head.y - 0.08;
          // A nearby raised palm invites an offer. Completion requires contact
          // with the animated hand itself, rather than screen overlap alone.
          const speed = Math.hypot(hand.velocity.x, hand.velocity.y) / handLength(hand);
          offering ||= palm.distanceTo(this.highFiveTarget) < 0.36 && !touchingHead
            && speed < PET_MIN_SPEED && !this.gestures.stroking(hand.id, nowMs);
          const rightHand = this.bones.get("R_Hand");
          if (this.activity === "highFive" && rightHand) {
            rightHand.getWorldPosition(this.target);
            if (palm.distanceTo(this.target) < 0.24) this.highFiveContact = true;
          }
        }
        if (!touchingHead) continue;
        touching = true;
        const speed = Math.hypot(hand.velocity.x, hand.velocity.y) / handLength(hand);
        if (speed > PET_MIN_SPEED || this.gestures.stroking(hand.id, nowMs)) contact = true;
      }
    }

    if (!offering) this.highFiveArmed = true;
    if (contact) {
      const names = human ? ["Petting", "Headpat"] : ["Headpat", "Petting", "Tail wag", "Happy"];
      const current = this.clips.get(this.clip);
      const replay = this.activity === "pet" && current?.loop === false && this.clipElapsed >= current.duration * 1000;
      this.play(names, "pet", nowMs, TOUCH_GRACE_MS, replay);
    } else if (offering && this.highFiveArmed && this.activity !== "highFive" && nowMs - this.lastHighFive > HIGH_FIVE_COOLDOWN_MS) {
      if (this.play(["High five"], "highFive", nowMs)) {
        this.lastHighFive = nowMs; this.highFiveContact = false; this.highFiveArmed = false;
      }
    } else if (!touching && this.visible()) {
      const beckon = signals.some(signal => signal.type === "beckon");
      const wave = signals.some(signal => signal.type === "wave");
      if (beckon && this.clips.has("Walk")) {
        this.approachTarget.copy(this.camera.position); this.approachTarget.y = 0;
        this.route = []; this.routeAt = -Infinity;
        this.play(["Walk"], "approach", nowMs, 25000);
      } else if (wave && this.activity !== "approach" && this.activity !== "highFive") {
        this.play(["Wave", "Tail wag", "Happy"], "wave", nowMs, undefined, true);
      }
    }

    if (this.activity === "approach") {
      this.approachTarget.copy(this.camera.position).setY(0);
      const distance = this.target.copy(this.approachTarget).sub(this.actor.position).setY(0).length();
      const stop = Math.max(human ? HUMAN_STOP_DISTANCE : CREATURE_STOP_DISTANCE,
        this.world ? this.bodyRadius + PLAYER_RADIUS + .08 : 0);
      if (distance <= stop + 0.005 || nowMs >= this.until) {
        if (distance > stop && distance <= stop + 0.005) this.moveActor(this.target.setLength(distance - stop));
        this.home.copy(this.actor.position); this.idle(nowMs);
      }
      else {
        // The baked Walk clips are in place. Only this ground-level parent moves.
        this.target.setLength(distance - stop).add(this.actor.position);
        const waypoint = this.navigationTarget(this.target, nowMs);
        if (!waypoint) { this.home.copy(this.actor.position); this.idle(nowMs); }
        else {
          this.movementHeading.copy(waypoint);
          this.target.copy(waypoint).sub(this.actor.position).setY(0);
          const remaining = this.target.length();
          this.moveSpeed += (Math.min(WALK_SPEED, (distance - stop) * 3) - this.moveSpeed) * (1 - Math.exp(-delta * 6));
          this.target.setLength(Math.min(this.moveSpeed * delta, remaining));
          if (this.moveActor(this.target) < 1e-6) { this.routeAt = -Infinity; this.route = []; }
        }
      }
    } else if (this.activity === "wander") {
      const distance = this.target.copy(this.wanderTarget).sub(this.actor.position).setY(0).length();
      if (distance < 0.04 || nowMs >= this.until) this.idle(nowMs);
      else {
        this.moveSpeed += (Math.min(WANDER_SPEED, distance * 2) - this.moveSpeed) * (1 - Math.exp(-delta * 5));
        const waypoint = this.navigationTarget(this.wanderTarget, nowMs);
        if (!waypoint) { this.idle(nowMs); this.target.set(0, 0, 0); }
        else { this.movementHeading.copy(waypoint); this.target.copy(waypoint).sub(this.actor.position).setY(0); }
        this.target.setLength(Math.min(this.moveSpeed * delta, this.target.length()));
        const currentDistance = Math.hypot(this.actor.position.x - this.camera.position.x, this.actor.position.z - this.camera.position.z);
        const nextDistance = Math.hypot(this.actor.position.x + this.target.x - this.camera.position.x, this.actor.position.z + this.target.z - this.camera.position.z);
        const buffer = human ? HUMAN_STOP_DISTANCE : CREATURE_STOP_DISTANCE;
        if (nextDistance < buffer && nextDistance < currentDistance) this.idle(nowMs);
        else if (this.moveActor(this.target) < 1e-6) this.idle(nowMs);
      }
    } else if (this.activity === "pet" && nowMs >= this.until) {
      const current = this.clips.get(this.clip);
      if (!current || current.loop || this.clipElapsed >= current.duration * 1000) this.afterPet(nowMs);
    } else if (this.activity !== "idle" && nowMs >= this.until) this.idle(nowMs);

    if (this.activity === "idle" && nowMs >= this.nextIdle && !touching) {
      if (this.clips.has("Walk") && this.random() < 0.55) this.wander(nowMs);
      else {
        const choices = this.profile.kind === "dog" ? ["Play bow", "Sniff"]
          : this.profile.name === "LeBron" ? ["Curious", "Shrug", "Drowsy"] : ["Curious", "Drowsy"];
        const available = choices.filter(name => this.clips.has(name));
        const fresh = available.filter(name => name !== this.lastIdleClip);
        const candidates = fresh.length ? fresh : available;
        if (candidates.length) {
          this.lastIdleClip = candidates[Math.floor(this.random() * candidates.length)];
          this.play([this.lastIdleClip], "idleAction", nowMs);
        }
        else this.nextIdle = nowMs + IDLE_MIN_MS;
      }
    }
    // Let the head attend to the user during quiet idle rather than rotating
    // the entire planted character on every small camera movement.
    if (this.activity !== "idle" && this.activity !== "idleAction") {
      this.face(this.activity === "wander" || this.activity === "approach" ? this.movementHeading : this.camera.position, delta);
    }
    this.idleMotion.update(delta, nowMs, this.activity === "idle" ? 1 : 0, this.camera.position);
    this.actor.updateMatrixWorld(true);
    if (followApproach && (this.activity === "approach" || this.activity === "wander")) {
      this.anchors();
      const distance = Math.hypot(this.head.x - this.camera.position.x, this.head.z - this.camera.position.z);
      this.cameraAngles.setFromQuaternion(this.camera.quaternion, "YXZ");
      const pitch = Math.atan2(this.head.y - this.camera.position.y, distance);
      this.cameraAngles.x += (pitch - this.cameraAngles.x) * (1 - Math.exp(-delta * 3));
      this.camera.quaternion.setFromEuler(this.cameraAngles);
      this.camera.updateMatrixWorld(true);
    }
    let action = ACTIVITY_LABELS[this.activity];
    if (this.activity === "highFive" && this.highFiveContact) action = "High five!";
    else if (this.activity === "afterPet" && this.profile.kind === "dog") action = "Wagging tail";
    else if (this.activity === "idleAction") action = IDLE_LABELS[this.clip] ?? action;
    else if (this.activity === "wave" && !this.clips.has("Wave")) action = this.clip === "Tail wag" ? "Wagging hello" : "Happy to see you";
    return `${this.profile.name}: ${action}`;
  }
}
