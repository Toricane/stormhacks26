import * as THREE from "three";
import type { CharacterAnimationPlayer, CharacterAnimation } from "../character-animation-player";
import type { CharacterProfile, HandFrame } from "../lifelike/controller";
import { CollisionWorld, PLAYER_RADIUS } from "../environments/collision-world.ts";
import { BallPhysics } from "./ball-physics.ts";
import { FetchCharacterPose } from "./character-pose.ts";
import { gripPosition, liveHands, ThrowSamples } from "./hand-ball.ts";

const BALL_RADIUS = .09;
const PICKUP_SECONDS = 1.25;
const GRAB_RADIUS = .25;
const RUN_SPEED = 1.65;
const RETURN_SPEED = 1.05;
type State = "absent" | "held" | "flying" | "retrieving" | "pickup" | "returning" | "offered";
type Options = {
  scene: THREE.Scene; actor: THREE.Group; root: THREE.Object3D; camera: THREE.PerspectiveCamera;
  player: CharacterAnimationPlayer; animations: CharacterAnimation[]; profile: CharacterProfile;
  onTakeControl: () => void; onReleaseControl: () => void;
};

/** One ball and one cancellable fetch transaction; no timers survive a recall. */
export class FetchController {
  readonly ball: THREE.Mesh;
  readonly physics: BallPhysics;
  private readonly pose: FetchCharacterPose;
  private readonly options: Options;
  private readonly clips: Set<string>;
  private readonly samples = new ThrowSamples();
  private world = new CollisionWorld();
  private bodyRadius = .35;
  private phase: State = "absent";
  private elapsed = 0;
  private owner: number | null = null;
  private armed = false;
  private lastSample = -1;
  private lastSeen = -Infinity;
  private clip = "";
  private route: THREE.Vector3[] = [];
  private routeAt = -Infinity;
  private stalled = 0;
  private unreachable = false;
  private readonly routeGoal = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly step = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly socket = new THREE.Vector3();
  private readonly heldLocal = new THREE.Vector3(.22, -.18, -.7);
  private readonly pickupStart = new THREE.Vector3();
  private readonly cameraAngles = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(options: Options) {
    this.options = options; this.clips = new Set(options.animations.map(clip => clip.name));
    this.pose = new FetchCharacterPose(options.root, options.profile);
    this.physics = new BallPhysics(this.world, BALL_RADIUS);
    const material = new THREE.MeshStandardMaterial({ color: 0xf27835, roughness: .72 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 16), material);
    this.ball.name = "Fetch ball"; this.ball.visible = false;
    // Contrasting great circles make spin and ground bounces readable.
    const seamMaterial = new THREE.MeshStandardMaterial({ color: 0x532e1b, roughness: .9 });
    for (let axis = 0; axis < 3; axis++) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS + .0005, .0018, 4, 48), seamMaterial);
      if (axis === 1) seam.rotation.x = Math.PI / 2;
      if (axis === 2) seam.rotation.y = Math.PI / 2;
      this.ball.add(seam);
    }
    options.scene.add(this.ball);
  }

  get state(): State { return this.phase; }
  get active(): boolean { return this.phase !== "absent"; }
  setWorld(world: CollisionWorld, bodyRadius: number, environment: THREE.Object3D | null = null): void {
    this.world = world; this.bodyRadius = bodyRadius;
    this.physics.setWorld(world); this.physics.setEnvironment(environment);
  }
  beforeAnimationUpdate(): void { this.pose.restore(); }

  recall(frame: HandFrame | null, now: number): void {
    this.options.onTakeControl(); this.pose.reset(); this.resetMotion();
    const hands = liveHands(frame, now);
    const hand = hands.find(hand => hand.id === this.owner) ?? hands.find(hand => hand.pose === "pinch")
      ?? hands.find(hand => hand.label === "Right") ?? hands[0];
    this.owner = hand?.id ?? null; this.phase = "held"; this.ball.visible = true;
    this.heldLocal.set(.22, -.18, -.7);
    this.options.camera.updateMatrixWorld(true);
    if (hand && frame) gripPosition(hand, frame, this.options.camera, this.point);
    else this.point.copy(this.heldLocal).applyMatrix4(this.options.camera.matrixWorld);
    this.physics.reset(this.point); this.ball.position.copy(this.point);
    this.play(["Idle", "idle"], true);
  }

  clear(resume = true): void {
    const wasActive = this.active;
    this.pose.reset(); this.resetMotion(); this.phase = "absent"; this.owner = null;
    this.ball.visible = false; this.physics.reset(this.ball.position);
    if (wasActive) { this.options.player.stop(); if (resume) this.options.onReleaseControl(); }
  }

  private resetMotion(): void {
    this.elapsed = 0; this.armed = false; this.lastSample = -1; this.lastSeen = -Infinity;
    this.samples.clear(); this.route = []; this.routeAt = -Infinity; this.stalled = 0;
    this.unreachable = false; this.clip = "";
  }
  private play(names: string[], immediate = false): void {
    const name = names.find(name => this.clips.has(name));
    this.options.player.setPlayback(true, 1);
    if (name && this.clip !== name) { this.options.player.play(name, immediate ? 0 : .18); this.clip = name; }
    else if (!name && this.clip) { this.options.player.stop(); this.clip = ""; }
  }
  private transition(state: State): void {
    this.phase = state; this.elapsed = 0; this.route = []; this.routeAt = -Infinity; this.stalled = 0;
    this.unreachable = false;
    this.play(state === "retrieving" ? ["Jog", "Trot", "Walk"]
      : state === "returning" ? ["Walk", "Jog", "Trot"] : ["Idle", "idle"]);
  }
  private face(point: THREE.Vector3, delta: number): void {
    const { actor, profile } = this.options;
    const desired = Math.atan2(point.x - actor.position.x, point.z - actor.position.z) - profile.forwardYaw;
    const difference = Math.atan2(Math.sin(desired - actor.rotation.y), Math.cos(desired - actor.rotation.y));
    actor.rotation.y += difference * (1 - Math.exp(-delta * 9));
  }

  private moveTo(destination: THREE.Vector3, speed: number, delta: number, now: number): void {
    const { actor, camera } = this.options;
    if (now - this.routeAt > 600 && (!this.route.length || this.routeGoal.distanceToSquared(destination) > .08)) {
      this.route = this.world.path(actor.position, destination, this.bodyRadius);
      this.routeGoal.copy(destination); this.routeAt = now;
    }
    while (this.route.length && Math.hypot(this.route[0].x - actor.position.x, this.route[0].z - actor.position.z) < .06) this.route.shift();
    const waypoint = this.route[0];
    if (!waypoint) { this.stalled += delta; return; }
    this.face(waypoint, delta);
    this.step.copy(waypoint).sub(actor.position).setY(0);
    this.step.setLength(Math.min(this.step.length(), speed * delta));
    const moved = this.world.move(actor.position, this.step, this.bodyRadius, { position: camera.position, radius: PLAYER_RADIUS });
    this.stalled = moved < .0001 ? this.stalled + delta : 0;
    if (this.stalled > .4) { this.route = []; }
  }

  private hands(frame: HandFrame | null, now: number): void {
    const { camera } = this.options;
    const hands = liveHands(frame, now);
    if (this.phase !== "held") {
      if (!frame) return;
      for (const hand of hands) {
        if (!(hand.pose === "pinch" || hand.closed)) continue;
        gripPosition(hand, frame, camera, this.point);
        if (this.point.distanceTo(this.ball.position) > GRAB_RADIUS || !this.world.clearSegment(camera.position, this.ball.position, .02)) continue;
        this.pose.reset(); this.resetMotion(); this.owner = hand.id; this.phase = "held";
        this.play(["Idle", "idle"], true); break;
      }
    }
    if (this.phase !== "held") return;
    const hand = hands.find(hand => hand.id === this.owner) ?? (this.owner === null ? hands[0] : undefined);
    if (!hand || !frame) {
      // Tracking loss is never interpreted as opening the hand to throw.
      this.armed = false; this.samples.clear();
      if (now - this.lastSeen > 800) this.owner = null;
      return;
    }
    this.owner = hand.id; this.lastSeen = now;
    gripPosition(hand, frame, camera, this.point);
    this.ball.position.copy(this.point); this.heldLocal.copy(this.point); camera.worldToLocal(this.heldLocal);
    if (frame.sampleTime === this.lastSample) return;
    this.lastSample = frame.sampleTime;
    const closed = hand.pose === "pinch" || hand.closed;
    if (closed) {
      this.armed = true; this.samples.add(frame.sampleTime, this.point, camera);
    } else if (this.armed) {
      this.samples.add(frame.sampleTime, this.point, camera);
      this.samples.velocity(camera, this.velocity);
      // Start in a supported place if a tracked hand reached through furniture.
      const safe = this.world.nearest(this.point, BALL_RADIUS, 1);
      if (safe) { this.point.x = safe.x; this.point.z = safe.z; }
      this.physics.throw(this.point, this.velocity); this.armed = false;
      this.transition("flying");
    }
  }

  update(delta: number, now: number, frame: HandFrame | null, follow = false): string {
    if (!this.active) return "";
    delta = Math.min(Math.max(delta, 0), .05); this.elapsed += delta;
    const { actor, camera, profile } = this.options;
    camera.updateMatrixWorld(true); actor.updateMatrixWorld(true);
    this.hands(frame, now);
    if (this.phase === "held") {
      this.face(camera.position, delta);
      if (!liveHands(frame, now).length) this.ball.position.copy(this.heldLocal).applyMatrix4(camera.matrixWorld);
      return this.owner === null ? "Show a hand to hold the ball · C to clear" : this.armed
        ? "Move your hand, then release the pinch to throw" : "Pinch the ball, move, then release to throw · C to clear";
    }
    if (this.phase === "flying" || this.phase === "retrieving") {
      this.physics.update(delta); this.ball.position.copy(this.physics.position);
      this.ball.rotation.x += this.physics.velocity.z * delta / BALL_RADIUS;
      this.ball.rotation.z -= this.physics.velocity.x * delta / BALL_RADIUS;
      if (this.phase === "flying" && this.elapsed > .25) this.transition("retrieving");
      if (this.phase === "retrieving") {
        this.target.copy(this.ball.position);
        const distance = Math.hypot(actor.position.x - this.target.x, actor.position.z - this.target.z);
        const reach = Math.max(.35, this.pose.pickupReach());
        const floor = this.world.floorHeight(this.target.x, this.target.z);
        const nearFloor = this.ball.position.y - floor < BALL_RADIUS + .18;
        if (distance <= reach && nearFloor && this.physics.velocity.length() < .8
          && this.world.clearSegment(actor.position, this.target, BALL_RADIUS)) {
          this.pickupStart.copy(this.ball.position); this.transition("pickup");
        } else {
          if (distance > reach * .8) this.moveTo(this.target, RUN_SPEED, delta, now);
          else { this.face(this.target, delta); this.stalled += delta; }
          this.unreachable = this.stalled > 3;
          if (this.unreachable) this.play(["Idle", "idle"]);
          else this.play(["Jog", "Trot", "Walk"]);
        }
      }
    }
    if (this.phase === "pickup") {
      this.face(this.pickupStart, delta);
      const progress = Math.min(1, this.elapsed / PICKUP_SECONDS);
      this.pose.apply("pickup", progress, delta, this.pickupStart);
      this.pose.socket(this.socket);
      if (progress > .5) this.ball.position.lerpVectors(this.pickupStart, this.socket, Math.min(1, (progress - .5) / .15));
      if (progress >= 1) this.transition("returning");
    } else if (this.phase === "returning" || this.phase === "offered") {
      this.target.copy(actor.position).sub(camera.position).setY(0);
      const distance = this.target.length();
      const stop = Math.max(this.bodyRadius + PLAYER_RADIUS + .1, profile.kind === "human" ? .9 : .8);
      if (distance > stop + .12) {
        if (this.phase === "offered") this.transition("returning");
        this.target.setLength(stop).add(camera.position);
        this.moveTo(this.target, RETURN_SPEED, delta, now);
      } else if (this.phase === "returning") this.transition("offered");
      if (this.phase === "offered") this.face(camera.position, delta);
      this.pose.apply(this.phase === "offered" ? "offer" : "carry",
        this.phase === "offered" ? Math.min(1, this.elapsed / .3) : 1, delta, camera.position);
      this.pose.socket(this.ball.position);
      this.unreachable = this.stalled > 3;
      if (this.unreachable) this.play(["Idle", "idle"]);
    }
    if (follow && (this.phase === "returning" || this.phase === "offered")) {
      this.cameraAngles.setFromQuaternion(camera.quaternion, "YXZ");
      const pitch = Math.atan2(this.ball.position.y - camera.position.y,
        Math.hypot(this.ball.position.x - camera.position.x, this.ball.position.z - camera.position.z));
      this.cameraAngles.x += (pitch - this.cameraAngles.x) * (1 - Math.exp(-delta * 3));
      camera.quaternion.setFromEuler(this.cameraAngles); camera.updateMatrixWorld(true);
    }
    if (this.unreachable) return `${profile.name}: Ball out of reach · B to recall · C to clear`;
    if (this.phase === "offered") return `Pinch the ball in ${profile.name}'s ${this.pose.holdingPart} to take it · B to recall · C to clear`;
    return `${profile.name}: ${this.phase === "pickup" ? "Picking up the ball" : this.phase === "returning" ? "Bringing it back" : "Fetching"} · B to recall · C to clear`;
  }

  dispose(): void {
    this.clear(false); this.ball.removeFromParent();
    const materials = new Set<THREE.Material>();
    this.ball.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    materials.forEach(material => material.dispose());
  }
}
