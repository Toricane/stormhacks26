import fs from "node:fs";
import assert from "node:assert/strict";
import { tau, smooth, envelope } from "./animation-tools.mjs";
import { humanoid } from "./humanoid-animation-tools.mjs";
import { humanProfiles, prepareHumanoidRig } from "./rig-humans.mjs";

const report = humanProfiles.map(profile => {
  const rig = humanoid(prepareHumanoidRig(profile), profile);
  const { nodes, bones: b, clip, rotate, arm, arms, lower, plant, gait } = rig;
  const energy = profile.energy;
  clip("Idle", 4.8, true, "Rest", "Relaxed breathing and small head and shoulder movements.", phase => {
    const sway = Math.sin(tau * phase), breath = 1 - Math.cos(tau * phase);
    rotate(b.chest, 0.3 * sway, 0.5 * sway, 0.35 * sway);
    rotate(b.neck, -0.3 * breath, 1 * Math.sin(tau * phase * 2), -0.4 * sway);
    arms(0.5 * sway, -0.5 * sway, 2 + 0.4 * sway, 2 - 0.4 * sway, 0.5);
    nodes[b.chest].scale.y *= 1 + 0.0015 * breath;
  });
  clip("Wave", profile.exuberant ? 3 : 3.4, false, "Greeting", "Raises his right hand, waves hello, then lowers it; the body stays still.", phase => {
    const amount = envelope(phase, 0.24, 0.28);
    const wave = Math.sin(tau * profile.waveCount * smooth((phase - 0.24) / 0.48));
    arm("R", { pitch: 15 * amount, spread: 50 * amount, twist: 90 * amount,
      bend: (112 + 8 * wave) * amount, wristRoll: 8 * wave * amount, wristYaw: 8 * amount });
  }, true);
  clip("Walk", profile.exuberant ? 1.25 : 1.45, true, "Movement", "Grounded alternating steps and opposite arm swings, ready for hand-target steering.", phase => {
    const step = Math.sin(tau * phase);
    rotate(b.chest, 0.7, 2 * step, 0.6 * step);
    arms(-10 * step, 10 * step, 6, 6, 1);
    rotate(b.neck, -0.6 * Math.sin(tau * phase * 2), -1.2 * step);
    gait(phase, profile.stride, 0.032);
  });
  clip("Jog", profile.exuberant ? 0.85 : 1, true, "Movement", "Quicker approach steps with bent elbows and higher foot lifts; stays in place.", phase => {
    const step = Math.sin(tau * phase);
    rotate(b.chest, -2, 2.5 * step, 0.8 * step);
    arms(-16 * step, 16 * step, 60, 60, 2);
    rotate(b.neck, 1.5, -1 * step);
    gait(phase, profile.stride * 1.35, 0.05, 0.58);
  });
  clip("Headpat", 3.4, false, "Affection", profile.exuberant
    ? "Ducks for a headpat and does three comically pleased head bobs."
    : "Politely ducks and leans into a headpat with a contented head tilt.", phase => {
    const amount = envelope(phase, 0.24, 0.28), bob = 1 - Math.cos(tau * phase * 3);
    lower(profile.duck * amount);
    rotate(b.waist, -3 * amount);
    rotate(b.neck, (-8 - 2 * bob) * amount, 0, 6 * amount);
    rotate(b.head, -2 * bob * amount);
    arms(2 * amount, 2 * amount, 12 * amount, 12 * amount);
    if (amount > 0) plant();
  });
  clip("Petting", 2.8, true, "Affection", "A silly head-scratch reaction with relaxed arms, a tilted head, and a contented sway.", phase => {
    const sway = Math.sin(tau * phase);
    rotate(b.chest, -1.5, sway * energy, 1.2 * sway * energy);
    rotate(b.neck, -7 + 1.5 * sway, 0, 8 + 1.5 * sway);
    rotate(b.head, -1.5 * (1 - Math.cos(tau * phase * 2)) * energy);
    arms(2, 2, 12, 12);
    nodes[b.chest].scale.y *= 1 + 0.002 * (1 - Math.cos(tau * phase));
  });
  clip("Curious", 3.2, false, "Attention", "Looks toward a hand and tips his head as if listening.", phase => {
    const amount = envelope(phase, 0.28, 0.3);
    rotate(b.chest, 0, 3 * amount);
    rotate(b.neck, -2 * amount, 13 * amount, 7 * amount);
    rotate(b.head, 0, 4 * amount);
  });
  clip("Nod", 2.2, false, "Attention", "Two gentle acknowledgement nods.", phase => {
    const nod = (1 - Math.cos(tau * phase * 2)) * envelope(phase);
    rotate(b.neck, -6 * nod); rotate(b.head, -1.5 * nod);
  });
  clip("High five", 3, false, "Greeting", "Offers his right palm and holds it briefly; the body stays still.", phase => {
    const amount = envelope(phase, 0.27, 0.3);
    arm("R", { pitch: 35 * amount, spread: 8 * amount, bend: 100 * amount,
      wristPitch: -8 * amount, wristYaw: 15 * amount });
  }, true);
  clip("Beckon", 3, false, "Greeting", "Curls his raised right forearm toward himself twice; the body stays still.", phase => {
    const amount = envelope(phase, 0.24, 0.28);
    const curl = Math.sin(tau * 2 * smooth((phase - 0.24) / 0.48));
    arm("R", { pitch: 20 * amount, spread: 8 * amount, bend: (85 + 20 * curl) * amount,
      wristPitch: 9 * curl * amount });
  }, true);
  clip("Celebrate", 3.2, false, "Reaction", profile.exuberant
    ? "An energetic two-arm cheer and small knee bounce."
    : "A restrained raised-hand victory gesture, small bounce, and appreciative nod.", phase => {
    const amount = envelope(phase, 0.22, 0.3), bounce = 0.5 * (1 - Math.cos(tau * phase * 3));
    lower(0.018 * bounce * amount * energy);
    if (profile.exuberant) arms(60 * amount, 60 * amount, 55 * amount, 55 * amount, 30 * amount);
    else arms(5 * amount, 40 * amount, 10 * amount, 80 * amount, 8 * amount);
    rotate(b.neck, 5 * amount - 2 * bounce * amount, 0, amount);
    if (amount > 0) plant();
  });
  clip("Shrug", 2.8, false, "Reaction", "A playful two-arm shrug with upturned hands.", phase => {
    const amount = envelope(phase, 0.28, 0.3);
    arm("L", { pitch: 5 * amount, spread: 12 * amount, twist: -35 * amount, bend: 65 * amount, wristYaw: -25 * amount });
    arm("R", { pitch: 5 * amount, spread: 12 * amount, twist: 35 * amount, bend: 65 * amount, wristYaw: 25 * amount });
  }, true);
  clip("Startled", 1.8, false, "Reaction", "Quickly recoils with raised hands and bent knees, then relaxes.", phase => {
    const amount = envelope(phase, 0.08, 0.62);
    lower(0.022 * amount); rotate(b.waist, 3 * amount); rotate(b.neck, 5 * amount);
    arms(15 * amount, 15 * amount, 65 * amount, 65 * amount, 12 * amount);
    if (amount > 0) plant();
  });
  clip("Drowsy", 5.6, true, "Rest", "Slow breathing and a gently bowed, bobbing head.", phase => {
    const breath = 1 - Math.cos(tau * phase);
    rotate(b.chest, -1); rotate(b.neck, -8 - breath, 0, 2); rotate(b.head, -1.5 * breath);
    arms(0, 0, 3, 3); nodes[b.chest].scale.y *= 1 + 0.0015 * breath;
  });
  const maxFootError = rig.maxFootError();
  assert.ok(maxFootError < 0.002, `${profile.name}: foot placement error ${maxFootError}`);
  return { ...rig.write(), character: profile.name, maxFootError, rig: rig.gltf.extras.humanoidRig };
});
fs.writeFileSync(new URL("human-animation-check.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
for (const character of report) console.log(`${character.character}: ${character.joints} joints, ${character.clips.length} clips (foot error ${character.maxFootError.toFixed(6)})`);
