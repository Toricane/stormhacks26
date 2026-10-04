import * as THREE from "three";
import { CollisionWorld } from "../environments/collision-world.ts";

const STEP = 1 / 120;
const GRAVITY = 9.81;
const RESTITUTION = .68;
const MAX_SPEED = 24;
const BIN_SIZE = .5;
const EPSILON = 1e-5;

/** Static, world-space mesh triangles. Construction happens once per environment;
 * the moving ball only examines triangles in the few bins it currently overlaps.
 * Double-sided contacts accommodate the inconsistent winding of room scans.
 */
class RoomMesh {
  readonly triangles: Float32Array;
  readonly bins = new Map<number, number[]>();
  readonly min: THREE.Vector3;
  readonly dimensions: THREE.Vector3;
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    const meshes: THREE.Mesh[] = [];
    let count = 0;
    const bounds = new THREE.Box3();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.geometry.attributes.position) return;
      meshes.push(object);
      const geometry = object.geometry;
      count += Math.floor((geometry.index?.count ?? geometry.attributes.position.count) / 3);
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld));
    });
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(), new THREE.Vector3());
    this.min = bounds.min.clone().divideScalar(BIN_SIZE).floor();
    this.dimensions = bounds.max.clone().divideScalar(BIN_SIZE).floor().sub(this.min).addScalar(1);
    this.triangles = new Float32Array(count * 9);
    this.seen = new Uint32Array(count);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let triangle = 0;
    for (const mesh of meshes) {
      const { index, attributes: { position } } = mesh.geometry;
      const length = index?.count ?? position.count;
      for (let i = 0; i + 2 < length; i += 3) {
        a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
        a.toArray(this.triangles, triangle * 9);
        b.toArray(this.triangles, triangle * 9 + 3);
        c.toArray(this.triangles, triangle * 9 + 6);
        const x0 = Math.floor(Math.min(a.x, b.x, c.x) / BIN_SIZE) - this.min.x;
        const y0 = Math.floor(Math.min(a.y, b.y, c.y) / BIN_SIZE) - this.min.y;
        const z0 = Math.floor(Math.min(a.z, b.z, c.z) / BIN_SIZE) - this.min.z;
        const x1 = Math.floor(Math.max(a.x, b.x, c.x) / BIN_SIZE) - this.min.x;
        const y1 = Math.floor(Math.max(a.y, b.y, c.y) / BIN_SIZE) - this.min.y;
        const z1 = Math.floor(Math.max(a.z, b.z, c.z) / BIN_SIZE) - this.min.z;
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const key = (z * this.dimensions.y + y) * this.dimensions.x + x;
          const bin = this.bins.get(key);
          if (bin) bin.push(triangle); else this.bins.set(key, [triangle]);
        }
        triangle++;
      }
    }
  }

  candidates(position: THREE.Vector3, radius: number, result: number[]): void {
    result.length = 0;
    this.stamp = (this.stamp + 1) >>> 0;
    if (!this.stamp) { this.seen.fill(0); this.stamp = 1; }
    const x0 = Math.max(0, Math.floor((position.x - radius) / BIN_SIZE) - this.min.x);
    const y0 = Math.max(0, Math.floor((position.y - radius) / BIN_SIZE) - this.min.y);
    const z0 = Math.max(0, Math.floor((position.z - radius) / BIN_SIZE) - this.min.z);
    const x1 = Math.min(this.dimensions.x - 1, Math.floor((position.x + radius) / BIN_SIZE) - this.min.x);
    const y1 = Math.min(this.dimensions.y - 1, Math.floor((position.y + radius) / BIN_SIZE) - this.min.y);
    const z1 = Math.min(this.dimensions.z - 1, Math.floor((position.z + radius) / BIN_SIZE) - this.min.z);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const bin = this.bins.get((z * this.dimensions.y + y) * this.dimensions.x + x);
      if (!bin) continue;
      for (const triangle of bin) if (this.seen[triangle] !== this.stamp) {
        this.seen[triangle] = this.stamp; result.push(triangle);
      }
    }
  }
}

const roomMeshes = new WeakMap<THREE.Object3D, RoomMesh>();

/** A small rubber ball, with fixed-time gravity and distance-limited collision
 * steps so fast throws cannot tunnel through thin walls. A supplied static room
 * mesh supplies actual floors, walls, furniture and ceilings. The nav map supplies
 * a safety floor and outer capture bounds when a scan has holes. Without a mesh,
 * its 2D obstacle proxy remains a conservative fallback (there is no fake ceiling).
 */
export class BallPhysics {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly radius: number;
  sleeping = true;
  private world: CollisionWorld;
  private room: RoomMesh | null = null;
  private accumulator = 0;
  private quietTime = 0;
  private readonly previous = new THREE.Vector3();
  private readonly triangle = new THREE.Triangle();
  private readonly closest = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly candidates: number[] = [];

  constructor(world: CollisionWorld, radius = .09) {
    if (!Number.isFinite(radius) || radius <= 0) throw new Error("A ball needs a positive radius.");
    this.world = world;
    this.radius = radius;
    this.position.y = radius;
  }

  get resting(): boolean { return this.sleeping; }

  setWorld(world: CollisionWorld): void {
    this.world = world;
    this.accumulator = this.quietTime = 0;
    this.sleeping = false;
  }

  /** Call after the environment's world transform is finalized. Reuse the same
   * root on subsequent selections to reuse its collision data. */
  setEnvironment(root: THREE.Object3D | null): void {
    this.room = null;
    if (root) {
      let mesh = roomMeshes.get(root);
      if (!mesh) { mesh = new RoomMesh(root); roomMeshes.set(root, mesh); }
      this.room = mesh;
    }
    this.accumulator = this.quietTime = 0;
    this.sleeping = false;
  }

  reset(position: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.accumulator = this.quietTime = 0;
    this.sleeping = false;
  }

  throw(position: THREE.Vector3, velocity: THREE.Vector3): void {
    this.reset(position);
    if (Number.isFinite(velocity.lengthSq())) this.velocity.copy(velocity).clampLength(0, MAX_SPEED);
    this.contain();
  }

  update(delta: number): void {
    if (this.sleeping || !Number.isFinite(delta) || delta <= 0) return;
    // Discard time spent in suspended tabs instead of doing unbounded catch-up.
    this.accumulator = Math.min(this.accumulator + delta, .25);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      const parts = Math.max(1, Math.ceil((this.velocity.length() + GRAVITY * STEP) * STEP / (this.radius * .4)));
      for (let i = 0; i < parts; i++) this.step(STEP / parts);
      if (this.sleeping) { this.accumulator = 0; break; }
    }
  }

  private respond(normal: THREE.Vector3): void {
    const incoming = this.velocity.dot(normal);
    if (incoming >= 0) return;
    // Stop tiny repeated bounces; larger impacts retain a rubber-ball rebound.
    const rebound = incoming < -.65 ? RESTITUTION : 0;
    this.velocity.addScaledVector(normal, -(1 + rebound) * incoming);
    if (normal.y > .35) {
      this.tangent.copy(this.velocity).addScaledVector(normal, -this.velocity.dot(normal));
      const speed = this.tangent.length();
      if (speed > 0) this.velocity.addScaledVector(this.tangent, -Math.min(1, -.14 * incoming / speed));
    }
  }

  private step(dt: number): void {
    this.previous.copy(this.position);
    this.velocity.y -= GRAVITY * dt;
    this.velocity.multiplyScalar(Math.exp(-.045 * dt));
    this.position.addScaledVector(this.velocity, dt);
    let grounded = false;
    if (this.room) {
      // A second pass resolves corners where one contact pushes into another.
      for (let pass = 0; pass < 2; pass++) {
        this.room.candidates(this.position, this.radius, this.candidates);
        for (const index of this.candidates) {
          const offset = index * 9;
          this.triangle.a.fromArray(this.room.triangles, offset);
          this.triangle.b.fromArray(this.room.triangles, offset + 3);
          this.triangle.c.fromArray(this.room.triangles, offset + 6);
          this.triangle.closestPointToPoint(this.position, this.closest);
          this.normal.subVectors(this.position, this.closest);
          const distance = this.normal.length();
          if (distance >= this.radius) continue;
          if (distance > EPSILON) this.normal.divideScalar(distance);
          else {
            this.triangle.getNormal(this.normal);
            if (this.normal.dot(this.velocity) > 0) this.normal.negate();
            if (this.normal.lengthSq() < .5) continue;
          }
          this.position.addScaledVector(this.normal, this.radius - distance + EPSILON);
          this.respond(this.normal);
          grounded ||= this.normal.y > .5;
        }
      }
    } else if (!this.world.canStand(this.position.x, this.position.z, this.radius)) {
      // The navigation proxy has no heights: it is only used before a mesh exists.
      const xBlocked = !this.world.canStand(this.position.x, this.previous.z, this.radius);
      const zBlocked = !this.world.canStand(this.previous.x, this.position.z, this.radius);
      if (xBlocked || !zBlocked) {
        this.position.x = this.previous.x;
        this.velocity.x *= -RESTITUTION;
      }
      if (zBlocked) { this.position.z = this.previous.z; this.velocity.z *= -RESTITUTION; }
      if (!this.world.canStand(this.position.x, this.position.z, this.radius)) {
        const safe = this.world.nearest(this.position, this.radius);
        if (safe) { this.position.x = safe.x; this.position.z = safe.z; }
      }
    }
    this.contain();
    const floor = this.world.floorHeight(this.position.x, this.position.z, this.radius) + this.radius;
    if (this.position.y <= floor) {
      this.position.y = floor;
      this.respond(this.normal.set(0, 1, 0));
      grounded = true;
    }
    if (grounded && Math.abs(this.velocity.y) < .1) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      const remaining = Math.max(0, speed - .85 * dt);
      if (speed > 0) { this.velocity.x *= remaining / speed; this.velocity.z *= remaining / speed; }
    }
    this.quietTime = grounded && this.velocity.lengthSq() < .055 ** 2 ? this.quietTime + dt : 0;
    if (this.quietTime >= .4) { this.velocity.set(0, 0, 0); this.sleeping = true; }
  }

  private contain(): void {
    const grid = this.world.grid;
    const minX = (grid ? grid.minX : -49) + this.radius;
    const maxX = (grid ? grid.minX + grid.width * grid.cellSize : 49) - this.radius;
    const minZ = (grid ? grid.minZ : -49) + this.radius;
    const maxZ = (grid ? grid.minZ + grid.depth * grid.cellSize : 49) - this.radius;
    if (this.position.x < minX) { this.position.x = minX; if (this.velocity.x < 0) this.velocity.x *= -RESTITUTION; }
    if (this.position.x > maxX) { this.position.x = maxX; if (this.velocity.x > 0) this.velocity.x *= -RESTITUTION; }
    if (this.position.z < minZ) { this.position.z = minZ; if (this.velocity.z < 0) this.velocity.z *= -RESTITUTION; }
    if (this.position.z > maxZ) { this.position.z = maxZ; if (this.velocity.z > 0) this.velocity.z *= -RESTITUTION; }
  }
}
