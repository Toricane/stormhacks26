import type { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import * as THREE from "three";
import { PLAYER_RADIUS, type CollisionWorld } from "./environments/collision-world.ts";

export const EYE_HEIGHT = 1.6;

export function moveFirstPerson(controls: PointerLockControls, keys: Set<string>, delta: number,
  collision?: { world: CollisionWorld; subject?: THREE.Vector3; subjectRadius?: number }) {
  const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  const right = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  const length = Math.hypot(forward, right);
  controls.object.updateMatrix();
  const original = collision ? controls.object.position.clone() : null;
  if (length) {
    const distance = 2 * delta / length;
    controls.moveForward(forward * distance);
    controls.moveRight(right * distance);
  }
  if (collision && original) {
    const displacement = controls.object.position.clone().sub(original).setY(0);
    controls.object.position.copy(original);
    collision.world.move(controls.object.position, displacement, PLAYER_RADIUS,
      collision.subject && collision.subjectRadius !== undefined
        ? { position: collision.subject, radius: collision.subjectRadius } : undefined);
    controls.object.position.y += EYE_HEIGHT;
  } else controls.object.position.y = EYE_HEIGHT;
}
