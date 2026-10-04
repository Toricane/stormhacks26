import fs from "node:fs";
import { creature, dogLegs, tau, radians, up, forward, sideways, smooth, envelope } from "./creature-animation-tools.mjs";

const pikachu = creature(new URL("../public/Pikachu.glb", import.meta.url));
const { nodes: p, rotate: turn, clip: pikaClip } = pikachu;
const named = name => {
  const index = pikachu.gltf.nodes.findIndex(node => node.name === name);
  if (index < 0) throw new Error(`Missing Pikachu joint: ${name}`);
  return index;
};
const root = named("Root"), body = named("Body"), chest = named("Chest"), head = named("Head");
const earL = named("Ear.L"), earR = named("Ear.R"), tipL = named("EarTip.L"), tipR = named("EarTip.R");
const armL = named("Arm.L"), armR = named("Arm.R"), pawL = named("Paw.L"), pawR = named("Paw.R");
const legL = named("Leg.L"), legR = named("Leg.R"), footL = named("Foot.L"), footR = named("Foot.R");

pikaClip("Wave", 2.8, false, "Greeting", "Raises one paw, waves three times, then lowers it with an ear perk.", phase => {
  const amount = envelope(phase, 0.2, 0.22);
  const wave = Math.sin(tau * 3 * smooth((phase - 0.2) / 0.58));
  turn(armL, -50 * amount, -20 * amount, (-18 + 18 * wave) * amount);
  turn(pawL, 0, 0, 18 * wave * amount);
  turn(head, -3 * amount, 6 * amount, -5 * amount);
  turn(chest, 0, -3 * amount, -2 * amount);
  turn(earL, -8 * amount, 0, -4 * amount);
  turn(earR, -5 * amount);
});
pikaClip("Walk", 1.2, true, "Movement", "Alternating little steps and opposite paw swings; stays in place for future steering.", phase => {
  const stride = Math.sin(tau * phase);
  const liftL = Math.max(0, stride), liftR = Math.max(0, -stride);
  turn(legL, 19 * stride); turn(legR, -19 * stride);
  turn(footL, -12 * stride); turn(footR, 12 * stride);
  p[legL].position.y += 0.028 * liftL ** 2;
  p[legR].position.y += 0.028 * liftR ** 2;
  p[root].position.y += 0.013 * (1 - Math.cos(tau * phase * 2));
  turn(body, 0, 3 * stride, 2 * stride);
  turn(armL, -10 * stride, 0, -3); turn(armR, 10 * stride, 0, 3);
  turn(head, 2 * Math.sin(tau * phase * 2), -2 * stride);
  turn(earL, 4 * Math.sin(tau * phase * 2)); turn(earR, -4 * Math.sin(tau * phase * 2));
});
pikaClip("Curious", 3.6, false, "Attention", "Pauses to listen, tilts its head, and perks one ear before returning to rest.", phase => {
  const amount = envelope(phase, 0.22, 0.25);
  turn(head, -5 * amount, 12 * amount, -16 * amount);
  turn(chest, -3 * amount, 3 * amount, -3 * amount);
  turn(earL, -10 * amount, 0, -8 * amount); turn(tipL, -5 * amount);
  turn(earR, 12 * amount, 0, 10 * amount); turn(tipR, 8 * amount);
  turn(armL, -7 * amount, 0, 5 * amount);
});
pikaClip("Petting", 3, true, "Affection", "Leans into a pet, relaxes its ears, and gently sways with its paws tucked in.", phase => {
  const sway = Math.sin(tau * phase), breath = 1 - Math.cos(tau * phase);
  turn(head, 7 + 2 * sway, 0, -9 + 3 * sway);
  turn(earL, 12 + 3 * sway, 0, -12); turn(earR, 14 - 3 * sway, 0, 12);
  turn(tipL, 9, 0, -8); turn(tipR, 9, 0, 8);
  turn(chest, 2, 0, 2 * sway);
  turn(armL, -9, 0, -7); turn(armR, -9, 0, 7);
  p[chest].scale.y *= 1 + 0.009 * breath;
});
pikaClip("Nuzzle", 2.6, false, "Affection", "Reaches both paws forward and leans its cheek toward a hand, then settles back.", phase => {
  const amount = envelope(phase, 0.3, 0.28);
  turn(head, 6 * amount, -8 * amount, 13 * amount);
  turn(chest, 6 * amount, 0, 3 * amount);
  turn(armL, -20 * amount, -6 * amount, -5 * amount);
  turn(armR, -20 * amount, 6 * amount, 5 * amount);
  turn(pawL, -12 * amount); turn(pawR, -12 * amount);
  turn(earL, 12 * amount); turn(earR, 12 * amount);
  p[head].position.z += 0.035 * amount;
});
pikaClip("Startled", 1.6, false, "Reaction", "A quick flinch with raised paws and perked ears, followed by a slower recovery.", phase => {
  const amount = envelope(phase, 0.08, 0.65);
  turn(chest, -7 * amount); turn(head, -10 * amount);
  turn(armL, -22 * amount, 0, 20 * amount); turn(armR, -22 * amount, 0, -20 * amount);
  turn(earL, -15 * amount, 0, 9 * amount); turn(earR, -15 * amount, 0, -9 * amount);
  p[head].position.y += 0.012 * amount;
});
pikaClip("Drowsy", 5, true, "Rest", "Sleepy breathing, a bowed head, drooped ear tips, and a slow head bob.", phase => {
  const breath = 1 - Math.cos(tau * phase);
  turn(head, 13 + 2 * breath, 0, 5);
  turn(earL, 22, 0, -18); turn(earR, 22, 0, 18);
  turn(tipL, 20, 0, -12); turn(tipR, 20, 0, 12);
  turn(armL, 5, 0, -6); turn(armR, 5, 0, 6);
  p[chest].scale.y *= 1 + 0.012 * breath;
});

const dog = creature(new URL("../public/dog-animated.glb", import.meta.url));
const { nodes: d, worldRotation: rotate, clip: dogClip, scene } = dog;
const { plant, gait, legs, solve } = dogLegs(dog);
const pitch = degrees => rotate(2, sideways, radians(degrees));
const wag = degrees => rotate(19, up, radians(degrees));
// The dog's forward direction is +X; Pikachu's is +Z. All locomotion is in place.
dog.gltf.animations.forEach(animation => {
  animation.extras = { ...animation.extras, category: animation.name === "Walk" ? "Movement" : "Rest",
    description: { Idle: "Soft head movement while waiting.", "Tail wag": "A relaxed standing tail wag.", Walk: "A slow four-beat walk in place." }[animation.name] };
});
dogClip("Trot", 0.9, true, "Movement", "A brisk diagonal gait with a lively tail; stays in place for future approach movement.", phase => {
  d[20].position.y -= 0.012 + 0.004 * Math.cos(tau * phase * 2);
  scene.updateMatrixWorld(true);
  pitch(2 * Math.sin(tau * phase * 2));
  wag(13 * Math.sin(tau * phase * 2));
  gait(phase, 0.09, 0.045, 0.6, true);
});
dogClip("Headpat", 3.2, false, "Affection", "Three soft head dips and a pleased tilt with a tail wag, returning to rest.", phase => {
  const amount = envelope(phase);
  pitch((-5 - 4 * (1 - Math.cos(tau * phase * 3))) * amount);
  rotate(2, forward, radians(7 * amount));
  wag(16 * Math.sin(tau * phase * 4) * amount);
});
dogClip("Scratch", 2, true, "Affection", "Leans into a scratch with a tipped head and an eager tail wag.", phase => {
  const sway = Math.sin(tau * phase);
  pitch(5 + 2 * sway);
  rotate(2, forward, radians(12 + 3 * sway));
  wag(27 * Math.sin(tau * phase * 4));
  rotate(9, up, radians(1.5 * sway));
  plant();
});
dogClip("Happy", 1.6, true, "Reaction", "An excited whole-body wiggle with a lifted head and a fast wag.", phase => {
  const wiggle = Math.sin(tau * phase * 2);
  rotate(10, up, radians(3 * wiggle));
  pitch(5 + 2 * Math.sin(tau * phase));
  wag(30 * Math.sin(tau * phase * 4));
  plant();
});
dogClip("Curious", 3.4, false, "Attention", "Looks to one side and tilts its head as if listening, then straightens up.", phase => {
  const amount = envelope(phase, 0.22, 0.25);
  rotate(2, up, radians(14 * amount));
  rotate(2, forward, radians(16 * amount));
  pitch(3 * amount);
  wag(6 * Math.sin(tau * phase * 2) * amount);
});
dogClip("Play bow", 3, false, "Greeting", "Lowers its chest with its hindquarters raised and tail wagging, inviting play.", phase => {
  const amount = envelope(phase, 0.25, 0.28);
  rotate(10, sideways, radians(-22 * amount));
  rotate(9, sideways, radians(-7 * amount));
  pitch(18 * amount);
  wag(23 * Math.sin(tau * phase * 4) * amount);
  if (amount > 0) plant();
});
dogClip("Sniff", 4, true, "Attention", "Lowers its nose and makes small searching movements near the ground.", phase => {
  rotate(10, sideways, radians(-10));
  pitch(-35 + 3 * Math.sin(tau * phase * 2));
  rotate(2, up, radians(7 * Math.sin(tau * phase)));
  wag(5 * Math.sin(tau * phase));
  plant();
});
dogClip("Shake", 2.2, false, "Reaction", "Shakes its head and shoulders in a quick ripple, then settles its tail.", phase => {
  const amount = envelope(phase, 0.15, 0.3);
  const shake = Math.sin(tau * phase * 6);
  rotate(10, forward, radians(5 * shake * amount));
  rotate(9, forward, radians(5 * Math.sin(tau * phase * 6 - 0.4) * amount));
  rotate(2, forward, radians(18 * Math.sin(tau * phase * 6 - 0.8) * amount));
  wag(14 * Math.sin(tau * phase * 6 - 1.2) * amount);
  if (amount > 0) plant();
});
dogClip("Offer paw", 3, false, "Greeting", "Lifts one front paw to offer a friendly shake, then places it back on the floor.", phase => {
  const amount = envelope(phase, 0.25, 0.28);
  const target = legs[1].foot.clone();
  target.x += 0.075 * amount; target.y += 0.1 * amount;
  if (amount > 0) solve(legs[1], target);
  pitch(4 * amount);
  wag(15 * Math.sin(tau * phase * 3) * amount);
});

const report = [pikachu.write(), dog.write()];
fs.writeFileSync(new URL("creature-animation-check.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
for (const creature of report) console.log(`${creature.file}: ${creature.clips.map(clip => clip.name).join(", ")}`);
