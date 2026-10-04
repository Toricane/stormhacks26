import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CollisionWorld, PLAYER_RADIUS, type CollisionGrid } from "./collision-world.ts";

export type EnvironmentId = "default" | "studyLounge";
export const ENVIRONMENTS: { id: EnvironmentId; name: string }[] = [
  { id: "default", name: "Default" }, { id: "studyLounge", name: "University study lounge" },
];
export type StudyLounge = { root: THREE.Group; world: CollisionWorld; data: CollisionGrid };

export async function loadStudyLounge(signal: AbortSignal): Promise<StudyLounge> {
  const [modelResponse, collisionResponse] = await Promise.all([
    fetch("/university-study-lounge.glb", { signal }), fetch("/university-study-lounge.collision.json", { signal }),
  ]);
  if (!modelResponse.ok || !collisionResponse.ok) throw new Error("The study lounge could not be loaded.");
  const [bytes, data] = await Promise.all([modelResponse.arrayBuffer(), collisionResponse.json() as Promise<CollisionGrid>]);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const world = new CollisionWorld(data);
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  const root = new THREE.Group(); root.name = "University study lounge";
  root.matrix.fromArray(data.transform); root.matrix.decompose(root.position, root.quaternion, root.scale);
  root.add(gltf.scene);
  // The scan contains an 8K texture. 4K retains the room detail while reducing
  // GPU memory and avoiding limits on smaller integrated GPUs.
  const textures = new Set<THREE.Texture>();
  gltf.scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material instanceof THREE.MeshBasicMaterial && material.map) textures.add(material.map);
    }
  });
  if (typeof createImageBitmap === "function") for (const texture of textures) {
    const source = texture.image;
    if (!(source instanceof ImageBitmap) && !(source instanceof HTMLImageElement)) continue;
    if (source.width > 4096 || source.height > 4096) {
      const size = 4096 / Math.max(source.width, source.height);
      texture.image = await createImageBitmap(source, { resizeWidth: Math.round(source.width * size),
        resizeHeight: Math.round(source.height * size), resizeQuality: "high", imageOrientation: "none" });
      if (source instanceof ImageBitmap) source.close();
      texture.needsUpdate = true;
    }
  }
  root.updateMatrixWorld(true);
  return { root, world, data };
}

/** Find room-safe positions in the photographed aisle, retaining a window-facing gaze. */
export function loungeSpawns(room: StudyLounge, subjectRadius: number): { player: THREE.Vector3; subject: THREE.Vector3 } {
  const preferred = new THREE.Vector3().fromArray(room.data.spawn.player);
  const ahead = new THREE.Vector3().fromArray(room.data.spawn.lookDirection).normalize().multiplyScalar(1.65);
  let result: { player: THREE.Vector3; subject: THREE.Vector3 } | null = null, score = Infinity;
  for (let z = -30; z <= 30; z++) for (let x = -30; x <= 30; x++) {
    const player = preferred.clone().add(new THREE.Vector3(x * .1, 0, z * .1));
    if (!room.world.canStand(player.x, player.z, PLAYER_RADIUS)) continue;
    const subject = player.clone().add(ahead);
    if (!room.world.canStand(subject.x, subject.z, subjectRadius)) continue;
    if (!room.world.clearSegment(player, subject, PLAYER_RADIUS)) continue;
    const distance = x * x + z * z;
    if (distance < score) {
      player.y = room.world.floorHeight(player.x, player.z, PLAYER_RADIUS);
      subject.y = room.world.floorHeight(subject.x, subject.z, subjectRadius);
      score = distance; result = { player, subject };
    }
  }
  if (!result) throw new Error("There is no safe window-side spawn for this character.");
  return result;
}
