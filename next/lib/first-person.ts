import type { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

export const EYE_HEIGHT = 1.6;

export function moveFirstPerson(controls: PointerLockControls, keys: Set<string>, delta: number) {
  const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  const right = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  const length = Math.hypot(forward, right);
  controls.object.updateMatrix();
  if (length) {
    const distance = 2 * delta / length;
    controls.moveForward(forward * distance);
    controls.moveRight(right * distance);
  }
  controls.object.position.y = EYE_HEIGHT;
}
