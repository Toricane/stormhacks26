import fs from "node:fs";
import assert from "node:assert/strict";
import { tau, smooth, envelope } from "./creature-animation-tools.mjs";
import { humanoid } from "./humanoid-animation-tools.mjs";
import { prepareKeanuRig } from "./prepare-keanu-rig.mjs";
import { prepareLebronSkin } from "./prepare-lebron-skin.mjs";

const profiles = [
  { file: "lebron_james.glb", name: "LeBron James", energy: 1, waveCount: 3, stride: 0.12, duck: 0.04, exuberant: true },
  { file: "keanu_reeves.glb", name: "Keanu Reeves", energy: 0.72, waveCount: 2, stride: 0.10, duck: 0.028, exuberant: false },
];
await prepareKeanuRig(new URL("../public/keanu_reeves.glb", import.meta.url));
await prepareLebronSkin(new URL("../public/lebron_james.glb", import.meta.url));

const report = profiles.map(profile => {
  const rig = humanoid(new URL(`../public/${profile.file}`, import.meta.url), profile);
  const { nodes, bones: b, clip, rotate, arms, lower, plant, gait } = rig;
  const energy = profile.energy;
  clip("Idle", 4.8, true, "Rest", "Relaxed breathing, small head movements, and subtle shoulder and hand motion.", phase => {
    const sway = Math.sin(tau * phase), breath = 1 - Math.cos(tau * phase);
    rotate(b.chest, 0.45 * sway, 0.7 * sway, 0.5 * sway);
    rotate(b.neck, -0.4 * breath, 1.5 * Math.sin(tau * phase * 2), -0.5 * sway);
    rotate(b.head, 0, 0.7 * sway);
    arms(0.7 * sway, -0.7 * sway, 2 + 0.5 * sway, 2 - 0.5 * sway, 1);
    nodes[b.chest].scale.y *= 1 + 0.002 * breath;
  });
  clip("Wave", profile.exuberant ? 3 : 3.4, false, "Greeting", "Raises a hand beside his face, waves hello, then lowers it naturally.", phase => {
    const amount = envelope(phase, 0.2, 0.24);
    const wave = Math.sin(tau * profile.waveCount * smooth((phase - 0.2) / 0.56));
    rotate(b.armR, 5 * amount, 0, -64 * amount);
    rotate(b.elbowR, 0, 0, (-112 + 15 * wave) * amount);
    rotate(b.handR, 6 * wave * amount, 12 * amount, -8 * wave * amount);
    rotate(b.neck, 0, -5 * amount, 3 * amount);
    rotate(b.chest, 0, -3 * amount);
  });
  clip("Walk", profile.exuberant ? 1.25 : 1.45, true, "Movement", "A grounded alternating walk with opposite arm swings, ready for hand-target steering.", phase => {
    const step = Math.sin(tau * phase);
    rotate(b.chest, 1, 2.5 * step, 0.8 * step);
    arms(-11 * step, 11 * step, 7, 7, 2);
    rotate(b.neck, -1 * Math.sin(tau * phase * 2), -1.5 * step);
    gait(phase, profile.stride, 0.035);
  });
  clip("Jog", profile.exuberant ? 0.85 : 1, true, "Movement", "A quicker approach gait with bent elbows and higher steps; no horizontal root motion.", phase => {
    const step = Math.sin(tau * phase);
    rotate(b.chest, -3, 3 * step, 1.2 * step);
    arms(-19 * step, 19 * step, 65, 65, 3);
    rotate(b.neck, 2, -1.5 * step);
    gait(phase, profile.stride * 1.35, 0.055, 0.58);
  });
  clip("Headpat", 3.4, false, "Affection", profile.exuberant
    ? "Ducks for a headpat, does three exaggerated pleased head bobs, then stands tall again."
    : "Politely ducks for a headpat and leans into it with a comically content head tilt.", phase => {
    const amount = envelope(phase, 0.2, 0.25);
    const bob = 1 - Math.cos(tau * phase * 3);
    lower(profile.duck * amount);
    rotate(b.waist, -4 * amount);
    rotate(b.neck, (-9 - 3 * bob) * amount, 0, 7 * amount);
    rotate(b.head, -3 * bob * amount);
    arms(3 * amount, 3 * amount, 20 * amount, 20 * amount, -3 * amount);
    if (amount > 0) plant();
  });
  clip("Petting", 2.8, true, "Affection", "A deliberately silly head-scratch reaction: relaxed shoulders, a tilted head, and a contented sway.", phase => {
    const sway = Math.sin(tau * phase);
    rotate(b.chest, -2, 1.5 * sway * energy, 1.8 * sway * energy);
    rotate(b.neck, -8 + 2 * sway, 0, 9 + 2 * sway);
    rotate(b.head, -2 * (1 - Math.cos(tau * phase * 2)) * energy);
    arms(4, 4, 28, 28, -4);
    nodes[b.chest].scale.y *= 1 + 0.003 * (1 - Math.cos(tau * phase));
  });
  clip("Curious", 3.2, false, "Attention", "Looks toward a hand and tips his head as if listening, then returns to neutral.", phase => {
    const amount = envelope(phase, 0.25, 0.28);
    rotate(b.chest, 0, 4 * amount);
    rotate(b.neck, -3 * amount, 15 * amount, 8 * amount);
    rotate(b.head, 0, 5 * amount);
    arms(0, 0, 6 * amount, 9 * amount);
  });
  clip("Nod", 2.2, false, "Attention", "Two gentle acknowledgement nods with a slight chest follow-through.", phase => {
    const amount = envelope(phase);
    const nod = (1 - Math.cos(tau * phase * 2)) * amount;
    rotate(b.neck, -7 * nod);
    rotate(b.head, -2 * nod);
    rotate(b.chest, -1.2 * nod);
  });
  clip("High five", 3, false, "Greeting", "Offers a raised palm in front of his shoulder, holds it briefly, then lowers his arm.", phase => {
    const amount = envelope(phase, 0.23, 0.25);
    rotate(b.armR, 70 * amount, 0, -12 * amount);
    rotate(b.elbowR, 95 * amount);
    rotate(b.handR, -8 * amount, 18 * amount);
    rotate(b.chest, 0, -4 * amount);
    rotate(b.neck, 0, 4 * amount);
  });
  clip("Beckon", 3, false, "Greeting", "Bends a raised forearm toward himself twice in a friendly come-here gesture.", phase => {
    const amount = envelope(phase, 0.2, 0.24);
    const curl = Math.sin(tau * 2 * smooth((phase - 0.2) / 0.55));
    rotate(b.armR, 25 * amount, 0, -8 * amount);
    rotate(b.elbowR, (80 + 20 * curl) * amount);
    rotate(b.handR, 9 * curl * amount);
    rotate(b.neck, -3 * amount, -5 * amount);
  });
  clip("Celebrate", 3.2, false, "Reaction", profile.exuberant
    ? "An energetic two-arm cheer with a small knee bounce and a proud head lift."
    : "A restrained victory gesture with a raised fist, small bounce, and appreciative nod.", phase => {
    const amount = envelope(phase, 0.18, 0.28);
    const bounce = 0.5 * (1 - Math.cos(tau * phase * 3));
    lower(0.022 * bounce * amount * energy);
    if (profile.exuberant) arms(60 * amount, 60 * amount, 70 * amount, 70 * amount, 42 * amount);
    else arms(8 * amount, 45 * amount, 20 * amount, 85 * amount, 9 * amount);
    rotate(b.neck, 6 * amount - 3 * bounce * amount, 0, 2 * amount);
    if (amount > 0) plant();
  });
  clip("Shrug", 2.8, false, "Reaction", "Raises his shoulders and opens his hands in a playful what-was-that reaction.", phase => {
    const amount = envelope(phase, 0.25, 0.28);
    arms(8 * amount, 8 * amount, 55 * amount, 55 * amount, 14 * amount);
    rotate(b.handL, 0, -55 * amount); rotate(b.handR, 0, 55 * amount);
    rotate(b.neck, -2 * amount, 0, -5 * amount);
    for (const name of ["L_Clavicle", "R_Clavicle"]) {
      const index = rig.gltf.nodes.findIndex(node => node.name === name);
      if (index >= 0) rotate(index, 0, 0, (name.startsWith("L") ? 5 : -5) * amount);
    }
  });
  clip("Startled", 1.8, false, "Reaction", "A quick recoil with raised hands and bent knees, followed by a slower relaxed recovery.", phase => {
    const amount = envelope(phase, 0.08, 0.6);
    lower(0.025 * amount);
    rotate(b.waist, 5 * amount);
    rotate(b.neck, 6 * amount);
    arms(18 * amount, 18 * amount, 65 * amount, 65 * amount, 18 * amount);
    if (amount > 0) plant();
  });
  clip("Drowsy", 5.6, true, "Rest", "Slow breathing and a gently bowed, bobbing head with relaxed arms.", phase => {
    const breath = 1 - Math.cos(tau * phase);
    rotate(b.chest, -1.5);
    rotate(b.neck, -9 - 1.5 * breath, 0, 3);
    rotate(b.head, -2 * breath);
    arms(0, 0, 4, 4, 1);
    nodes[b.chest].scale.y *= 1 + 0.0025 * breath;
  });
  const maxFootError = rig.maxFootError();
  assert.ok(maxFootError < 0.002, `${profile.name}: foot placement error ${maxFootError}`);
  return { ...rig.write(), character: profile.name, maxFootError, rigRepair: rig.gltf.extras.humanoidRigRepair ?? null,
    skinRepair: rig.gltf.extras.humanoidSkinRepair ?? null };
});
fs.writeFileSync(new URL("human-animation-check.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
for (const character of report) console.log(`${character.character}: ${character.clips.map(clip => clip.name).join(", ")} (max foot error ${character.maxFootError.toFixed(6)})`);
