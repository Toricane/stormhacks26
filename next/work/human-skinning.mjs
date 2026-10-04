import assert from "node:assert/strict";
import { meshComponents } from "./glb-tools.mjs";
import { smooth } from "./animation-tools.mjs";

// Below the armpits these replacement meshes have three separate surface
// components. Use connectivity, including welded UV seams, rather than the
// nearest bone: the hand sits very close to the trousers in the source pose.
export function armOwnership(positions, triangles, profile) {
  const count = positions.length / 3, cut = profile.armCut;
  const components = meshComponents(positions, triangles, i => positions[i * 3 + 1] < cut);
  const stats = new Map();
  for (let i = 0; i < count; i++) {
    if (components[i] === 0xffffffff) continue;
    let item = stats.get(components[i]);
    if (!item) { item = { count: 0, minY: Infinity, minZ: Infinity, maxZ: -Infinity }; stats.set(components[i], item); }
    item.count++;
    item.minY = Math.min(item.minY, positions[i * 3 + 1]);
    item.minZ = Math.min(item.minZ, positions[i * 3 + 2]);
    item.maxZ = Math.max(item.maxZ, positions[i * 3 + 2]);
  }
  const armComponents = new Set([...stats.entries()].filter(([, s]) => s.minY > -0.12 && (s.minZ > 0.09 || s.maxZ < -0.09)).map(([id]) => id));
  assert.equal(armComponents.size, 2, `${profile.name}: distinct left/right arms below the armpits`);
  const anchor = new Int8Array(count); anchor.fill(-1);
  const valid = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1], z = Math.abs(positions[i * 3 + 2]);
    if (y < cut) anchor[i] = armComponents.has(components[i]) ? 1 : 0;
    else if (z < 0.081 || y > 0.365) anchor[i] = 0;
    // Deltoid/sleeve anchors; leave the shoulder attachment free to blend.
    else if (z > 0.139 && y < 0.28) anchor[i] = 1;
    valid[i] = y >= cut - 0.008 && y < 0.38 ? 1 : 0;
  }
  const offsets = new Uint32Array(count + 1);
  const weldEdges = [];
  const weld = new Map();
  for (let i = 0; i < count; i++) {
    if (!valid[i]) continue;
    const key = [0, 1, 2].map(a => Math.round(positions[i * 3 + a] * 1e6)).join(",");
    const match = weld.get(key);
    if (match !== undefined) weldEdges.push(match, i);
    else weld.set(key, i);
  }
  function edges(fn) {
    const edge = (a, b) => { if (valid[a] && valid[b]) { fn(a, b); fn(b, a); } };
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      edge(a, b); edge(b, c); edge(c, a);
    }
    for (let i = 0; i < weldEdges.length; i += 2) edge(weldEdges[i], weldEdges[i + 1]);
  }
  edges(a => offsets[a + 1]++);
  for (let i = 1; i <= count; i++) offsets[i] += offsets[i - 1];
  const adjacent = new Uint32Array(offsets[count]), cursor = offsets.slice();
  edges((a, b) => { adjacent[cursor[a]++] = b; });
  function distances(label) {
    const distance = new Float64Array(count); distance.fill(Infinity);
    const heap = [];
    function push(vertex, cost) {
      let i = heap.length; heap.push([vertex, cost]);
      while (i) {
        const parent = (i - 1) >> 1;
        if (heap[parent][1] <= cost) break;
        heap[i] = heap[parent]; i = parent;
      }
      heap[i] = [vertex, cost];
    }
    for (let i = 0; i < count; i++) if (valid[i] && anchor[i] === label) { distance[i] = 0; push(i, 0); }
    while (heap.length) {
      const [vertex, cost] = heap[0], last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          const left = i * 2 + 1, right = left + 1;
          const child = right < heap.length && heap[right][1] < heap[left][1] ? right : left;
          if (heap[child][1] >= last[1]) break;
          heap[i] = heap[child]; i = child;
        }
        heap[i] = last;
      }
      if (cost > distance[vertex]) continue;
      for (let k = offsets[vertex]; k < offsets[vertex + 1]; k++) {
        const other = adjacent[k];
        const candidate = cost + Math.hypot(...[0, 1, 2].map(a => positions[vertex * 3 + a] - positions[other * 3 + a]));
        if (candidate < distance[other]) { distance[other] = candidate; push(other, candidate); }
      }
    }
    return distance;
  }
  const armDistance = distances(1), bodyDistance = distances(0);
  const ownership = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (anchor[i] >= 0) ownership[i] = anchor[i];
    else if (!Number.isFinite(armDistance[i])) ownership[i] = 0;
    else if (!Number.isFinite(bodyDistance[i])) ownership[i] = 1;
    // A distance ratio reaches exactly 0/1 at the anchors, avoiding a weight
    // discontinuity where the disconnected lower sleeve enters this band.
    else ownership[i] = smooth(bodyDistance[i] / Math.max(1e-9, bodyDistance[i] + armDistance[i]));
  }
  // Smooth the free shoulder band along the mesh. Hard anchors stay exact;
  // in particular, coat tails, shorts, legs, torso core and head stay at zero.
  for (let iteration = 0; iteration < 24; iteration++) {
    const next = ownership.slice();
    for (let i = 0; i < count; i++) {
      if (!valid[i] || anchor[i] >= 0 || offsets[i] === offsets[i + 1]) continue;
      let total = 0;
      for (let k = offsets[i]; k < offsets[i + 1]; k++) total += ownership[adjacent[k]];
      next[i] = 0.5 * ownership[i] + 0.5 * total / (offsets[i + 1] - offsets[i]);
    }
    ownership.set(next);
  }
  return { ownership, components, armComponents };
}

export function skinHumanoid(positions, ownership, bones, profile) {
  const count = positions.length / 3;
  const joints = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
  const bone = name => bones[name].joint;
  const mix = (a, b, amount) => [[bone(a), 1 - amount], [bone(b), amount]];
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1], z = positions[i * 3 + 2], arm = ownership[i];
    let body;
    if (y > 0.35) body = mix("Neck", "Head", smooth((y - 0.355) / 0.04));
    else if (y > 0.305) body = mix("Chest", "Neck", smooth((y - 0.305) / 0.05));
    else if (y > 0.17) body = mix("Spine", "Chest", smooth((y - 0.17) / 0.07));
    else if (y > 0.065) body = mix("Waist", "Spine", smooth((y - 0.065) / 0.075));
    else body = mix("Hip", "Waist", smooth((y + 0.015) / 0.065));
    const legAmount = 1 - smooth((y + 0.13) / 0.10);
    if (legAmount > 0) {
      const right = smooth((z + 0.022) / 0.044);
      const legs = [];
      for (const [side, amount] of [["L", 1 - right], ["R", right]]) {
        const knee = bones[`${side}_Calf`].position[1], ankle = bones[`${side}_Foot`].position[1];
        const foot = 1 - smooth((y - ankle + 0.017) / 0.034);
        const calf = 1 - smooth((y - knee + 0.029) / 0.058);
        const entries = foot > 0 ? mix(`${side}_Calf`, `${side}_Foot`, foot) : mix(`${side}_Thigh`, `${side}_Calf`, calf);
        for (const [joint, weight] of entries) legs.push([joint, weight * amount * legAmount]);
      }
      body = [...body.map(([j, w]) => [j, w * (1 - legAmount)]), ...legs];
    }
    let entries = body.map(([j, w]) => [j, w * (1 - arm)]);
    if (arm > 0) {
      const side = z < 0 ? "L" : "R";
      const elbow = bones[`${side}_Forearm`].position[1], wrist = bones[`${side}_Hand`].position[1];
      const hand = 1 - smooth((y - wrist + 0.012) / 0.024);
      const forearm = 1 - smooth((y - elbow + 0.026) / 0.052);
      const limb = hand > 0 ? mix(`${side}_Forearm`, `${side}_Hand`, hand) : mix(`${side}_Upperarm`, `${side}_Forearm`, forearm);
      entries.push(...limb.map(([j, w]) => [j, w * arm]));
    }
    entries = entries.filter(([, w]) => w > 1e-7).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = entries.reduce((total, [, w]) => total + w, 0);
    assert.ok(sum > 0 && Number.isFinite(sum));
    for (let k = 0; k < entries.length; k++) { joints[i * 4 + k] = entries[k][0]; weights[i * 4 + k] = entries[k][1] / sum; }
  }
  return { joints, weights };
}
