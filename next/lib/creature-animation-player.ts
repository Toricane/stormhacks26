import * as THREE from "three";

export type CreatureAnimation = {
  name: string;
  duration: number;
  loop: boolean;
  inPlace: boolean;
  category: string;
  description: string;
};

export function describeAnimation(clip: THREE.AnimationClip): CreatureAnimation {
  return {
    name: clip.name,
    duration: clip.duration,
    loop: clip.userData.loop !== false,
    inPlace: clip.userData.in_place === true,
    category: typeof clip.userData.category === "string" ? clip.userData.category : "Animation",
    description: typeof clip.userData.description === "string" ? clip.userData.description : "",
  };
}

// Playback only: a future hand/behavior controller can select clips through play().
// Locomotion clips stay in place so that controller can steer the scene object.
export class CreatureAnimationPlayer {
  readonly mixer: THREE.AnimationMixer;
  private active: THREE.AnimationAction | null = null;
  private retiring = new Map<THREE.AnimationAction, number>();
  private root: THREE.Object3D;
  private clips: THREE.AnimationClip[];

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root = root;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(root);
  }

  play(name: string, fadeSeconds = 0.22) {
    const clip = this.clips.find(clip => clip.name === name);
    if (!clip) return false;
    const duration = Math.max(0, fadeSeconds);
    const previous = this.active;
    const next = this.mixer.clipAction(clip);
    this.retiring.delete(next);
    if (!duration) {
      for (const action of this.retiring.keys()) action.stop();
      this.retiring.clear();
    }
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    const { loop } = describeAnimation(clip);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.play();
    if (previous && previous !== next) {
      // Keep the current weight during rapid selections so unfinished fades do
      // not suddenly jump to full strength. Retire actions after the fade ends.
      const weight = previous.getEffectiveWeight();
      previous.stopFading().setEffectiveWeight(weight);
      if (duration) {
        previous.fadeOut(duration);
        this.retiring.set(previous, this.mixer.time + duration);
      } else previous.stop();
    }
    if (duration && previous !== next) next.fadeIn(duration);
    this.active = next;
    this.mixer.update(0);
    return true;
  }

  update(delta: number) {
    this.mixer.update(delta);
    for (const [action, end] of this.retiring) {
      if (this.mixer.time >= end) { action.stop(); this.retiring.delete(action); }
    }
  }

  setPlayback(playing: boolean, speed: number) {
    this.mixer.timeScale = playing ? speed : 0;
  }

  stop() {
    this.mixer.stopAllAction();
    this.retiring.clear();
    this.active = null;
  }

  dispose() {
    this.stop();
    this.mixer.uncacheRoot(this.root);
  }
}
