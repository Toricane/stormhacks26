export const RIG_TYPES = [
  { value: "biped", label: "Biped (2 legs)" },
  { value: "quadruped", label: "Quadruped (4 legs)" },
  { value: "hexapod", label: "Hexapod (6 legs)" },
  { value: "octopod", label: "Octopod (8 legs)" },
  { value: "avian", label: "Avian (bird / winged)" },
  { value: "serpentine", label: "Serpentine (snake-like)" },
  { value: "aquatic", label: "Aquatic (fish / aquatic)" },
] as const;

export type RigType = (typeof RIG_TYPES)[number]["value"];

export function isRigType(value: unknown): value is RigType {
  return RIG_TYPES.some(type => type.value === value);
}
