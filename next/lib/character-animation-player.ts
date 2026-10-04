import * as THREE from "three";

export type CharacterAnimation = { name: string; duration: number; loop: boolean; inPlace: boolean; description: string; category: string };

export function describeAnimation(clip: THREE.AnimationClip): CharacterAnimation {
  const data = (clip as THREE.AnimationClip & { userData?: Record<string, unknown> }).userData ?? {};
  return { name: clip.name, duration: clip.duration, loop: data.loop !== false, inPlace: data.in_place === true,
    description: typeof data.description === "string" ? data.description : "",
    category: typeof data.category === "string" ? data.category : "" };
}

/** Reusable playback for the viewer and a future hand/behavior controller. */
export class CharacterAnimationPlayer {
  readonly mixer: THREE.AnimationMixer;
  private readonly entries = new Map<string, { clip: THREE.AnimationClip; actions: THREE.AnimationAction[] }>();
  private readonly retiring = new Map<THREE.AnimationAction, number>();
  private readonly root: THREE.Object3D;
  private current: THREE.AnimationAction | null = null;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) this.entries.set(clip.name, { clip, actions: [this.mixer.clipAction(clip)] });
  }

  play(name: string, fadeSeconds = 0.22): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    // Reuse an inactive action. An action that is fading out still contributes
    // to the visible pose, so rapid selection must not reset it either.
    let next = entry.actions.find(action => !action.isScheduled());
    if (!next) { next = this.mixer.clipAction(entry.clip.clone()); entry.actions.push(next); }
    const fade = Math.max(0, Number.isFinite(fadeSeconds) ? fadeSeconds : 0.22);
    let blend = false;
    for (const { actions } of this.entries.values()) {
      for (const action of actions) {
        if (action === next || !action.isScheduled()) continue;
        if (fade === 0) { action.stop(); this.retiring.delete(action); }
        else {
          // Preserve each action's current weight when interrupting a fade.
          const weight = action.getEffectiveWeight();
          action.stopFading().setEffectiveWeight(weight).fadeOut(fade);
          this.retiring.set(action, this.mixer.time + fade); blend = true;
        }
      }
    }
    this.retiring.delete(next);
    next.stop().reset().stopFading().setEffectiveWeight(1).setEffectiveTimeScale(1);
    const { loop } = describeAnimation(entry.clip);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    if (blend) next.fadeIn(fade);
    next.play(); this.current = next;
    return true;
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
    this.mixer.update(deltaSeconds);
    for (const [action, end] of this.retiring) {
      if (this.mixer.time >= end) { action.stop(); this.retiring.delete(action); }
    }
  }

  setPlayback(playing: boolean, speed = 1): void {
    this.mixer.timeScale = playing ? Math.max(0, Number.isFinite(speed) ? speed : 1) : 0;
  }

  stop(): void {
    this.mixer.stopAllAction(); this.retiring.clear(); this.current = null;
  }

  dispose(): void { this.stop(); this.mixer.uncacheRoot(this.root); this.entries.clear(); }
}
