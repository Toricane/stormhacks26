import * as THREE from "three";
import { creature, radians, up, forward, sideways, tau } from "./creature-animation-tools.mjs";

export function humanoid(file, profile) {
  const rig = creature(file);
  const { gltf, nodes, rest, scene, worldRotation } = rig;
  const named = name => {
    const index = gltf.nodes.findIndex(node => node.name === name);
    if (index < 0) throw new Error(`${profile.name}: missing joint ${name}`);
    return index;
  };
  const coarse = profile.name === "Keanu Reeves";
  const bones = {
    root: named(coarse ? "tripo::Root" : "Root"),
    chest: named(coarse ? "tripo::Spine_0" : "Spine02"),
    waist: named(coarse ? "tripo::Spine_0" : "Waist"),
    neck: named(coarse ? "tripo::Spine_1" : "NeckTwist01"),
    head: named(coarse ? "tripo::Spine_2" : "Head"),
    armL: named("L_Upperarm"), elbowL: named("L_Forearm"), handL: named("L_Hand"),
    armR: named("R_Upperarm"), elbowR: named("R_Forearm"), handR: named("R_Hand"),
  };
  const legs = (coarse ? [[6, 5, 4, 3], [10, 9, 8, 7]]
    : [[named("L_Thigh"), named("L_Calf"), named("L_Foot"), named("L_ToeBase")],
      [named("R_Thigh"), named("R_Calf"), named("R_Foot"), named("R_ToeBase")]])
    .map(([hip, knee, foot, toe]) => ({ hip, knee, foot, toe, target: rest[foot].worldPosition.clone() }));
  const footErrors = [];
  function rotate(index, pitch = 0, yaw = 0, roll = 0) {
    // Both supplied humans face +X, so world Z is the sagittal pitch axis.
    if (pitch) worldRotation(index, sideways, radians(pitch));
    if (yaw) worldRotation(index, up, radians(yaw));
    if (roll) worldRotation(index, forward, radians(roll));
  }
  function align(joint, end, target) {
    const pivot = nodes[joint].getWorldPosition(new THREE.Vector3());
    const current = nodes[end].getWorldPosition(new THREE.Vector3()).sub(pivot).normalize();
    const desired = target.clone().sub(pivot).normalize();
    const world = nodes[joint].getWorldQuaternion(new THREE.Quaternion())
      .premultiply(new THREE.Quaternion().setFromUnitVectors(current, desired));
    nodes[joint].quaternion.copy(nodes[joint].parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)).normalize();
    scene.updateMatrixWorld(true);
  }
  function solve(leg, target) {
    const hip = nodes[leg.hip].getWorldPosition(new THREE.Vector3());
    const knee = nodes[leg.knee].getWorldPosition(new THREE.Vector3());
    const foot = nodes[leg.foot].getWorldPosition(new THREE.Vector3());
    const upper = hip.distanceTo(knee), lower = knee.distanceTo(foot);
    const direction = target.clone().sub(hip);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(upper - lower) + 0.000001, upper + lower - 0.000001);
    direction.normalize();
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    const bend = forward.clone().addScaledVector(direction, -forward.dot(direction)).normalize();
    const desiredKnee = hip.clone().addScaledVector(direction, along).addScaledVector(bend, height);
    align(leg.hip, leg.knee, desiredKnee); align(leg.knee, leg.foot, target);
    nodes[leg.foot].quaternion.copy(nodes[leg.foot].parent.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(rest[leg.foot].worldQuaternion)).normalize();
    scene.updateMatrixWorld(true);
    footErrors.push(nodes[leg.foot].getWorldPosition(new THREE.Vector3()).distanceTo(target));
  }
  function plant() { legs.forEach(leg => solve(leg, leg.target)); }
  function lower(amount) {
    nodes[bones.root].position.y -= amount;
    scene.updateMatrixWorld(true);
  }
  function gait(phase, stride = 0.11, lift = 0.035, duty = 0.62) {
    lower(0.012 + 0.4 * stride ** 2 + 0.005 * (1 - Math.cos(tau * phase * 2)));
    legs.forEach((leg, index) => {
      const cycle = (phase + index * 0.5) % 1;
      const target = leg.target.clone();
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
  function arms(leftPitch = 0, rightPitch = 0, leftBend = 0, rightBend = 0, spread = 0) {
    rotate(bones.armL, leftPitch, 0, spread); rotate(bones.armR, rightPitch, 0, -spread);
    rotate(bones.elbowL, leftBend); rotate(bones.elbowR, rightBend);
  }
  return { ...rig, bones, profile, rotate, arms, lower, plant, gait,
    maxFootError: () => Math.max(0, ...footErrors) };
}
