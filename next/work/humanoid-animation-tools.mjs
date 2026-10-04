import * as THREE from "three";
import { animationRig, radians, up, forward, sideways, tau } from "./animation-tools.mjs";

export function humanoid(file, profile) {
  const rig = animationRig(file);
  const { gltf, nodes, rest, scene, worldRotation } = rig;
  const named = name => {
    const index = gltf.nodes.findIndex(node => node.name === name);
    if (index < 0) throw new Error(`${profile.name}: missing joint ${name}`);
    return index;
  };
  const bones = {
    root: named("Root"), chest: named("Chest"), waist: named("Waist"), neck: named("Neck"), head: named("Head"),
    armL: named("L_Upperarm"), elbowL: named("L_Forearm"), handL: named("L_Hand"),
    armR: named("R_Upperarm"), elbowR: named("R_Forearm"), handR: named("R_Hand"),
  };
  const legs = ["L", "R"].map(side => ({ hip: named(`${side}_Thigh`), knee: named(`${side}_Calf`),
    foot: named(`${side}_Foot`), target: rest[named(`${side}_Foot`)].worldPosition.clone() }));
  let maxFootError = 0;
  function rotate(index, pitch = 0, yaw = 0, roll = 0) {
    // Both replacement meshes face +X: pitch Z, yaw Y, roll X.
    if (pitch) worldRotation(index, sideways, radians(pitch));
    if (yaw) worldRotation(index, up, radians(yaw));
    if (roll) worldRotation(index, forward, radians(roll));
  }
  function align(joint, end, target) {
    const pivot = nodes[joint].getWorldPosition(new THREE.Vector3());
    const current = nodes[end].getWorldPosition(new THREE.Vector3()).sub(pivot).normalize();
    const desired = target.clone().sub(pivot).normalize();
    const q = nodes[joint].getWorldQuaternion(new THREE.Quaternion())
      .premultiply(new THREE.Quaternion().setFromUnitVectors(current, desired));
    nodes[joint].quaternion.copy(nodes[joint].parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)).normalize();
    scene.updateMatrixWorld(true);
  }
  function solve(leg, target) {
    const hip = nodes[leg.hip].getWorldPosition(new THREE.Vector3());
    const knee = nodes[leg.knee].getWorldPosition(new THREE.Vector3());
    const foot = nodes[leg.foot].getWorldPosition(new THREE.Vector3());
    const upper = hip.distanceTo(knee), lower = knee.distanceTo(foot);
    const direction = target.clone().sub(hip);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(upper - lower) + 1e-6, upper + lower - 1e-6);
    direction.normalize();
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    const bend = forward.clone().addScaledVector(direction, -forward.dot(direction)).normalize();
    align(leg.hip, leg.knee, hip.clone().addScaledVector(direction, along).addScaledVector(bend, height));
    align(leg.knee, leg.foot, target);
    nodes[leg.foot].quaternion.copy(nodes[leg.foot].parent.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(rest[leg.foot].worldQuaternion)).normalize();
    scene.updateMatrixWorld(true);
    maxFootError = Math.max(maxFootError, nodes[leg.foot].getWorldPosition(new THREE.Vector3()).distanceTo(target));
  }
  function plant() { legs.forEach(leg => solve(leg, leg.target)); }
  function lower(amount) { nodes[bones.root].position.y -= amount; scene.updateMatrixWorld(true); }
  function gait(phase, stride, lift, duty = 0.62) {
    lower(0.009 + 0.4 * stride ** 2 + 0.004 * (1 - Math.cos(tau * phase * 2)));
    legs.forEach((leg, index) => {
      const cycle = (phase + index * 0.5) % 1, target = leg.target.clone();
      if (cycle < duty) target.x += stride / 2 - stride * cycle / duty;
      else {
        const t = (cycle - duty) / (1 - duty);
        const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h01 = -2 * t ** 3 + 3 * t ** 2;
        const h10 = t ** 3 - 2 * t ** 2 + t, h11 = t ** 3 - t ** 2;
        target.x += h00 * (-stride / 2) + h01 * stride / 2 + (h10 + h11) * (1 - duty) * (-stride / duty);
        target.y += lift * Math.sin(Math.PI * t) ** 2;
      }
      solve(leg, target);
    });
  }
  function arm(side, { pitch = 0, spread = 0, twist = 0, bend = 0, wristPitch = 0, wristYaw = 0, wristRoll = 0 } = {}) {
    const upper = side === "L" ? bones.armL : bones.armR;
    const elbow = side === "L" ? bones.elbowL : bones.elbowR;
    const hand = side === "L" ? bones.handL : bones.handR;
    rotate(upper, pitch, 0, side === "L" ? spread : -spread);
    if (twist) {
      const axis = nodes[elbow].getWorldPosition(new THREE.Vector3()).sub(nodes[upper].getWorldPosition(new THREE.Vector3())).normalize();
      worldRotation(upper, axis, radians(twist));
    }
    // The hinge follows the humerus, so elbow flexion stays in one plane.
    const hinge = rest[elbow].worldPosition.clone().sub(rest[upper].worldPosition).normalize()
      .cross(forward).normalize().applyQuaternion(nodes[upper].getWorldQuaternion(new THREE.Quaternion()));
    worldRotation(elbow, hinge, radians(THREE.MathUtils.clamp(bend, 0, 125)));
    nodes[hand].quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(radians(wristRoll), radians(wristYaw), radians(wristPitch))));
    scene.updateMatrixWorld(true);
  }
  function arms(leftPitch = 0, rightPitch = 0, leftBend = 0, rightBend = 0, spread = 0) {
    arm("L", { pitch: leftPitch, spread, bend: leftBend });
    arm("R", { pitch: rightPitch, spread, bend: rightBend });
  }
  return { ...rig, bones, profile, rotate, arm, arms, lower, plant, gait, maxFootError: () => maxFootError };
}
