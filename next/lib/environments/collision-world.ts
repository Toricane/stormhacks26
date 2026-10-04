import * as THREE from "three";

export type CollisionGrid = {
  version: number; cellSize: number; width: number; depth: number; minX: number; minZ: number;
  walkable: string; floorHeights: number[]; transform: number[];
  spawn: { player: number[]; subject: number[]; lookDirection: number[] };
};
export const PLAYER_RADIUS = 0.25;

/** Static room collision shared by the camera and autonomous characters.
 * Unsupported floor and reconstruction margins are solid, just like furniture.
 */
export class CollisionWorld {
  readonly grid: CollisionGrid | null;
  private readonly clearance: Float32Array;
  private readonly safeByRadius = new Map<number, Uint8Array>();

  constructor(grid: CollisionGrid | null = null) {
    if (grid && (grid.version !== 1 || !Number.isInteger(grid.width) || !Number.isInteger(grid.depth)
      || grid.width <= 0 || grid.depth <= 0 || !Number.isFinite(grid.cellSize + grid.minX + grid.minZ) || grid.cellSize <= 0
      || grid.walkable.length !== grid.width * grid.depth || /[^01]/.test(grid.walkable)
      || grid.floorHeights.length !== grid.width * grid.depth || !grid.floorHeights.every(Number.isFinite)
      || grid.transform.length !== 16 || !grid.transform.every(Number.isFinite))) {
      throw new Error("The environment collision map is invalid.");
    }
    this.grid = grid;
    this.clearance = grid ? this.buildClearance(grid) : new Float32Array();
  }

  private buildClearance(grid: CollisionGrid): Float32Array {
    const { width, depth, cellSize } = grid;
    const distances = Float32Array.from(grid.walkable, value => value === "1" ? 1e6 : 0);
    // Two-pass chamfer distance; subtract a cell diagonal and a small margin
    // so interpolation/scan noise cannot put a body through a furniture edge.
    const update = (x: number, z: number, dx: number, dz: number) => {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= depth) { distances[z * width + x] = 0; return; }
      const i = z * width + x;
      distances[i] = Math.min(distances[i], distances[nz * width + nx] + (dx && dz ? Math.SQRT2 : 1));
    };
    for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
      update(x, z, -1, 0); update(x, z, 0, -1); update(x, z, -1, -1); update(x, z, 1, -1);
    }
    for (let z = depth - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
      update(x, z, 1, 0); update(x, z, 0, 1); update(x, z, 1, 1); update(x, z, -1, 1);
    }
    for (let i = 0; i < distances.length; i++) distances[i] = Math.max(0, distances[i] * cellSize - cellSize * 1.42);
    return distances;
  }

  private index(x: number, z: number): number {
    const grid = this.grid!;
    const ix = Math.floor((x - grid.minX) / grid.cellSize), iz = Math.floor((z - grid.minZ) / grid.cellSize);
    return ix < 0 || iz < 0 || ix >= grid.width || iz >= grid.depth ? -1 : iz * grid.width + ix;
  }

  private point(index: number, result = new THREE.Vector3()): THREE.Vector3 {
    const grid = this.grid!;
    return result.set(grid.minX + (index % grid.width + 0.5) * grid.cellSize, grid.floorHeights[index],
      grid.minZ + (Math.floor(index / grid.width) + 0.5) * grid.cellSize);
  }

  canStand(x: number, z: number, radius: number): boolean {
    if (!Number.isFinite(x + z + radius) || radius < 0) return false;
    if (!this.grid) return Math.abs(x) + radius < 49 && Math.abs(z) + radius < 49;
    const index = this.index(x, z);
    return index >= 0 && this.clearance[index] >= radius;
  }

  floorHeight(x: number, z: number, radius = 0): number {
    if (!this.grid) return 0;
    const index = this.index(x, z);
    if (index < 0) return 0;
    let height = this.grid.floorHeights[index];
    const cells = Math.ceil(radius / this.grid.cellSize);
    const ix = index % this.grid.width, iz = Math.floor(index / this.grid.width);
    for (let dz = -cells; dz <= cells; dz++) for (let dx = -cells; dx <= cells; dx++) {
      const nx = ix + dx, nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= this.grid.width || nz >= this.grid.depth) continue;
      if (Math.hypot(dx, dz) * this.grid.cellSize > radius + this.grid.cellSize * .71) continue;
      const nearby = nz * this.grid.width + nx;
      if (this.grid.walkable[nearby] === "1") height = Math.max(height, this.grid.floorHeights[nearby]);
    }
    return height;
  }

  /** Swept small steps prevent tunneling even after a long browser frame. */
  move(position: THREE.Vector3, displacement: THREE.Vector3, radius: number,
    avoid?: { position: THREE.Vector3; radius: number }): number {
    const startX = position.x, startZ = position.z;
    const distance = Math.hypot(displacement.x, displacement.z);
    if (!Number.isFinite(distance)) return 0;
    const steps = Math.max(1, Math.ceil(distance / 0.035));
    const dx = displacement.x / steps, dz = displacement.z / steps;
    const valid = (x: number, z: number) => this.canStand(x, z, radius)
      && (!avoid || Math.hypot(x - avoid.position.x, z - avoid.position.z) >= radius + avoid.radius);
    for (let i = 0; i < steps; i++) {
      if (valid(position.x + dx, position.z + dz)) { position.x += dx; position.z += dz; }
      else {
        // Sliding along furniture feels natural while remaining inside free floor.
        if (valid(position.x + dx, position.z)) position.x += dx;
        if (valid(position.x, position.z + dz)) position.z += dz;
      }
    }
    position.y = this.floorHeight(position.x, position.z, radius);
    return Math.hypot(position.x - startX, position.z - startZ);
  }

  nearest(position: THREE.Vector3, radius: number, maxDistance = Infinity): THREE.Vector3 | null {
    if (this.canStand(position.x, position.z, radius)) return position.clone().setY(this.floorHeight(position.x, position.z));
    if (!this.grid) {
      const p = position.clone(); p.x = THREE.MathUtils.clamp(p.x, -48.9 + radius, 48.9 - radius);
      p.z = THREE.MathUtils.clamp(p.z, -48.9 + radius, 48.9 - radius); p.y = 0;
      return p.distanceTo(position) <= maxDistance ? p : null;
    }
    let best = maxDistance * maxDistance, selected = -1;
    const point = new THREE.Vector3();
    for (let i = 0; i < this.clearance.length; i++) {
      if (this.clearance[i] < radius) continue;
      this.point(i, point);
      const distance = (point.x - position.x) ** 2 + (point.z - position.z) ** 2;
      if (distance < best) { best = distance; selected = i; }
    }
    return selected < 0 ? null : this.point(selected);
  }

  clearSegment(start: THREE.Vector3, end: THREE.Vector3, radius: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / 0.04));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.canStand(THREE.MathUtils.lerp(start.x, end.x, t), THREE.MathUtils.lerp(start.z, end.z, t), radius)) return false;
    }
    return true;
  }

  /** A* routes around furniture. An unreachable goal never produces a wall-crossing path. */
  path(start: THREE.Vector3, requestedGoal: THREE.Vector3, radius: number): THREE.Vector3[] {
    const goal = this.nearest(requestedGoal, radius, 1.5);
    if (!goal) return [];
    if (this.clearSegment(start, goal, radius)) return [goal];
    if (!this.grid) return [];
    const { width, depth } = this.grid;
    const first = this.index(start.x, start.z), last = this.index(goal.x, goal.z);
    if (first < 0 || last < 0) return [];
    const key = Math.ceil(radius * 100);
    let safe = this.safeByRadius.get(key);
    if (!safe) { safe = Uint8Array.from(this.clearance, distance => Number(distance >= radius)); this.safeByRadius.set(key, safe); }
    const costs = new Float32Array(width * depth).fill(Infinity), parents = new Int32Array(width * depth).fill(-1);
    const closed = new Uint8Array(width * depth);
    const heap: { id: number; score: number }[] = [];
    const heuristic = (id: number) => Math.hypot(id % width - last % width, Math.floor(id / width) - Math.floor(last / width));
    const push = (id: number, score: number) => {
      let i = heap.length; heap.push({ id, score });
      while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].score <= score) break; heap[i] = heap[parent]; i = parent; }
      heap[i] = { id, score };
    };
    const pop = () => {
      const value = heap[0], tail = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
          if (heap[child].score >= tail.score) break;
          heap[i] = heap[child]; i = child;
        }
        heap[i] = tail;
      }
      return value.id;
    };
    costs[first] = 0; push(first, heuristic(first));
    while (heap.length) {
      const current = pop();
      if (closed[current]) continue;
      if (current === last) {
        const route: THREE.Vector3[] = [goal];
        for (let i = current; i !== first && i >= 0; i = parents[i]) route.push(this.point(i));
        route.reverse();
        // Remove safe intermediate corners, retaining swept clearance.
        const simplified: THREE.Vector3[] = []; let origin = start;
        for (let i = 0; i < route.length;) {
          let next = i;
          while (next + 1 < route.length && this.clearSegment(origin, route[next + 1], radius)) next++;
          simplified.push(route[next]); origin = route[next]; i = next + 1;
        }
        return simplified;
      }
      closed[current] = 1;
      const x = current % width, z = Math.floor(current / width);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= depth) continue;
        const id = nz * width + nx;
        if (!safe[id] || closed[id] || (dx && dz && (!safe[z * width + nx] || !safe[nz * width + x]))) continue;
        const cost = costs[current] + (dx && dz ? Math.SQRT2 : 1);
        if (cost < costs[id]) { costs[id] = cost; parents[id] = current; push(id, cost + heuristic(id)); }
      }
    }
    return [];
  }
}
