"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { EYE_HEIGHT, moveFirstPerson } from "@/lib/first-person";
import { CharacterAnimationPlayer, describeAnimation, type CharacterAnimation } from "@/lib/character-animation-player";
import FirstPersonHands from "@/components/first-person-hands";
import { LifelikeController, characterProfile, type HandFrame } from "@/lib/lifelike/controller";
import { CollisionWorld, PLAYER_RADIUS } from "@/lib/environments/collision-world";
import { loadStudyLounge, loungeSpawns, type EnvironmentId, type StudyLounge } from "@/lib/environments/study-lounge";
import { FetchController } from "@/lib/fetch/controller";

type Rig = { bones: THREE.Bone[]; rest: THREE.Quaternion[]; helper: THREE.SkeletonHelper };
export type ViewerView = "model" | "animation" | "firstPerson" | "lifelike";
type View = ViewerView;
function walkingView(view: View): boolean { return view === "firstPerson" || view === "lifelike"; }
const FIRST_PERSON_HUMAN_HEIGHTS: Record<string, number> = {
  "keanu.glb": 1.72, "keanu-animated.glb": 1.72,
  "lebron.glb": 2.06, "lebron-animated.glb": 2.06,
};
type ViewScene = {
  camera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  firstPerson: PointerLockControls;
  renderer: THREE.WebGLRenderer;
  group: THREE.Group;
  actor: THREE.Group;
  environment: THREE.Group;
  defaultEnvironment: THREE.Group;
  lounge: StudyLounge | null;
  world: CollisionWorld;
  subjectRadius: number;
  ready: boolean;
  grid: THREE.GridHelper;
  box: THREE.Box3;
  center: THREE.Vector3;
  size: number;
  firstPersonHeight: number | undefined;
};

function dispose(root: THREE.Object3D) {
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        Object.values(material).forEach(value => { if (value instanceof THREE.Texture) { value.image?.close?.(); value.dispose(); } });
        material.dispose();
      }
    }
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
}

export default function Viewer({ url, view, environmentId, onEnvironmentChange, active }: {
  active: boolean;
  url: string;
  view: ViewerView;
  environmentId: EnvironmentId;
  onEnvironmentChange: (id: EnvironmentId) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const model = useRef<THREE.Object3D | null>(null);
  const rig = useRef<Rig | null>(null);
  const player = useRef<CharacterAnimationPlayer | null>(null);
  const viewScene = useRef<ViewScene | null>(null);
  const lifelike = useRef<LifelikeController | null>(null);
  const fetchGame = useRef<FetchController | null>(null);
  const handFrame = useRef<HandFrame | null>(null);
  const behaviorRef = useRef("");
  const [behaviorAction, setBehaviorAction] = useState("");
  const onHands = useCallback((frame: HandFrame | null) => { handFrame.current = frame; }, []);
  const keys = useRef(new Set<string>());
  const viewRef = useRef<View>(view);
  const activeRef = useRef(active);
  const needsRender = useRef(true);
  useEffect(() => { needsRender.current = true; });
  const [loaded, setLoaded] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [animations, setAnimations] = useState<CharacterAnimation[]>([]);
  const [animation, setAnimation] = useState("");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [boneNames, setBoneNames] = useState<string[]>([]);
  const [boneIndex, setBoneIndex] = useState(0);
  const [angles, setAngles] = useState({ x: 0, y: 0, z: 0 });
  const [skeleton, setSkeleton] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [message, setMessage] = useState(url ? "Loading model…" : "");
  const [environmentRevision, setEnvironmentRevision] = useState(0);
  const [environmentStatus, setEnvironmentStatus] = useState("");

  useEffect(() => {
    const host = container.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setMessage("WebGL is unavailable in this browser."); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf6f6f6);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const firstPerson = new PointerLockControls(camera, renderer.domElement);
    firstPerson.enabled = false;
    firstPerson.minPolarAngle = 0.15;
    firstPerson.maxPolarAngle = Math.PI - 0.15;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 5, 4); scene.add(light);
    let closed = false;
    let frame = 0;
    const onLock = () => { if (!closed) setNavigationError(""); };
    const onUnlock = () => { keys.current.clear(); };
    const onLockError = () => { if (!closed) setNavigationError("Mouse capture failed. Click the canvas again to enter."); };
    const enter = () => {
      if (!activeRef.current || !walkingView(viewRef.current) || !viewScene.current?.ready) return;
      if (!renderer.domElement.requestPointerLock) {
        setNavigationError("This browser does not support mouse capture.");
        return;
      }
      try { Promise.resolve(renderer.domElement.requestPointerLock()).catch(onLockError); }
      catch { onLockError(); }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current || !walkingView(viewRef.current) || !viewScene.current?.ready) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.code === "KeyB" || event.code === "KeyC") {
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        if (event.code === "KeyB") fetchGame.current?.recall(handFrame.current, performance.now());
        else fetchGame.current?.clear();
        return;
      }
      if (!firstPerson.isLocked) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        event.preventDefault(); keys.current.add(event.code);
      } else if (event.code === "Space") event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => { keys.current.delete(event.code); };
    const onBlur = () => { keys.current.clear(); if (firstPerson.isLocked) firstPerson.unlock(); };
    firstPerson.addEventListener("lock", onLock);
    firstPerson.addEventListener("unlock", onUnlock);
    document.addEventListener("pointerlockerror", onLockError);
    renderer.domElement.addEventListener("click", enter);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    const resize = () => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix(); needsRender.current = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host); resize();
    const controller = new AbortController();
    const group = new THREE.Group();
    const actor = new THREE.Group();
    actor.add(group); scene.add(actor);
    const box = new THREE.Box3(new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(.5, 1, .5));
    const center = box.getCenter(new THREE.Vector3());
    const grid = new THREE.GridHelper(6, 20, 0xaaaaaa, 0xdddddd);
    scene.add(grid);
    const environment = new THREE.Group();
    const defaultEnvironment = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.001;
    defaultEnvironment.add(ground, new THREE.GridHelper(100, 100, 0xaaaaaa, 0xcccccc));
    environment.add(defaultEnvironment); scene.add(environment);
    viewScene.current = { camera, orbit: controls, firstPerson, renderer, group, actor, environment, defaultEnvironment,
      lounge: null, world: new CollisionWorld(), subjectRadius: .35, ready: true, grid, box, center, size: 3, firstPersonHeight: undefined };
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Model download failed.");
        const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
        if (closed) { dispose(gltf.scene); return; }
        const root = gltf.scene;
        model.current = root;
        group.scale.setScalar(1); group.position.set(0, 0, 0);
        actor.position.set(0, 0, 0); actor.rotation.set(0, 0, 0);
        group.add(root); root.updateMatrixWorld(true);
        box.setFromObject(root); box.getCenter(center);
        const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.1);
        const source = gltf.userData.humanoidRig?.source;
        const assetName = typeof source === "string" ? source : new URL(url, window.location.href).pathname.split("/").pop() ?? "";
        viewScene.current!.size = size;
        viewScene.current!.firstPersonHeight = FIRST_PERSON_HUMAN_HEIGHTS[assetName];
        grid.scale.setScalar(size / 2); grid.position.set(center.x, box.min.y, center.z);
        const bones: THREE.Bone[] = [];
        root.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
        const helper = new THREE.SkeletonHelper(root);
        const material = helper.material as THREE.LineBasicMaterial;
        material.depthTest = false; helper.renderOrder = 10;
        scene.add(helper);
        rig.current = { bones, rest: bones.map(bone => bone.quaternion.clone()), helper };
        player.current = new CharacterAnimationPlayer(root, gltf.animations);
        const descriptions = gltf.animations.map(describeAnimation);
        lifelike.current = new LifelikeController({ actor, root, camera, player: player.current,
          animations: descriptions, profile: characterProfile(assetName, bones) });
        fetchGame.current = new FetchController({ scene, actor, root, camera, player: player.current,
          animations: descriptions, profile: characterProfile(assetName, bones),
          onTakeControl: () => lifelike.current?.deactivate(),
          onReleaseControl: () => {
            if (viewRef.current === "lifelike" && activeRef.current) lifelike.current?.activate(performance.now());
            else { player.current?.setPlayback(true, 1); player.current?.play(descriptions.find(clip => clip.name === "Idle")?.name ?? descriptions[0]?.name ?? ""); }
          },
        });
        setAnimations(descriptions);
        setAnimation(viewRef.current === "model" ? "" : gltf.animations[0]?.name || "");
        setBoneNames(bones.map((bone, index) => bone.name || `Bone ${index + 1}`));
        setMessage(bones.length ? `${bones.length} bones. Rotate a joint to inspect skin deformation.` : "Static mesh. Select the Auto rig model to check deformation.");
        setModelLoaded(true); setLoaded(true);
      } catch (error) {
        if (!closed) {
          setMessage(error instanceof Error ? error.message : "Could not load model.");
          setLoaded(true);
        }
      }
    }
    if (url) void load();
    else setLoaded(true);
    let previousTime = performance.now();
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      if (activeRef.current) {
        lifelike.current?.beforeAnimationUpdate();
        fetchGame.current?.beforeAnimationUpdate();
        player.current?.update(delta);
      }
      previousTime = time;
      if (activeRef.current && walkingView(viewRef.current)) {
        const current = viewScene.current;
        if (current?.ready) {
          moveFirstPerson(firstPerson, firstPerson.isLocked ? keys.current : new Set(), delta,
            { world: current.world, subject: model.current ? current.actor.position : undefined, subjectRadius: current.subjectRadius });
        }
      } else if (activeRef.current) controls.update();
      if (activeRef.current && walkingView(viewRef.current) && viewScene.current?.ready) {
        const action = fetchGame.current?.active
          ? fetchGame.current.update(delta, time, handFrame.current, !firstPerson.isLocked)
          : viewRef.current === "lifelike" ? lifelike.current?.update(delta, time, handFrame.current, !firstPerson.isLocked) ?? "" : "";
        if (action !== behaviorRef.current) { behaviorRef.current = action; setBehaviorAction(action); }
      }
      if (activeRef.current || needsRender.current) {
        renderer.render(scene, camera); needsRender.current = false;
      }
    };
    frame = requestAnimationFrame(animate);
    return () => {
      closed = true; controller.abort(); cancelAnimationFrame(frame);
      keys.current.clear();
      if (firstPerson.isLocked) firstPerson.unlock();
      firstPerson.removeEventListener("lock", onLock);
      firstPerson.removeEventListener("unlock", onUnlock);
      firstPerson.dispose();
      document.removeEventListener("pointerlockerror", onLockError);
      renderer.domElement.removeEventListener("click", enter);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      lifelike.current?.deactivate();
      fetchGame.current?.dispose(); fetchGame.current = null;
      observer.disconnect(); controls.dispose(); dispose(scene); renderer.dispose();
      player.current?.dispose(); player.current = null;
      lifelike.current = null; handFrame.current = null;
      viewScene.current = null;
      renderer.domElement.remove(); model.current = null; rig.current = null;
    };
  }, [url]);

  useEffect(() => {
    const current = viewScene.current;
    if (!loaded || !current || environmentId !== "studyLounge" || current.lounge) return;
    const abort = new AbortController(); let cancelled = false;
    setEnvironmentStatus("Loading study lounge…"); current.ready = false;
    void loadStudyLounge(abort.signal).then(room => {
      if (cancelled || viewScene.current !== current) { dispose(room.root); return; }
      current.lounge = room; current.environment.add(room.root);
      setEnvironmentStatus(""); setEnvironmentRevision(value => value + 1);
    }).catch(error => {
      if (cancelled) return;
      setEnvironmentStatus(error instanceof Error ? error.message : "The environment could not be loaded.");
      onEnvironmentChange("default");
    });
    return () => { cancelled = true; abort.abort(); };
  }, [environmentId, loaded, url, onEnvironmentChange]);

  useEffect(() => {
    viewRef.current = view;
    keys.current.clear(); setNavigationError("");
    const current = viewScene.current;
    if (!current) return;
    const { camera, orbit, firstPerson, renderer, group, actor, environment, grid, box, center, size, firstPersonHeight } = current;
    lifelike.current?.deactivate();
    fetchGame.current?.clear(false);
    const walking = walkingView(view);
    actor.position.set(0, 0, 0); actor.rotation.set(0, 0, 0);
    orbit.enabled = activeRef.current && !walking; firstPerson.enabled = activeRef.current && walking;
    environment.visible = walking || environmentId === "studyLounge" || !url;
    grid.visible = !walking && environmentId === "default" && !!url;
    const lounge = environmentId === "studyLounge" ? current.lounge : null;
    current.ready = !(environmentId === "studyLounge" && !lounge);
    current.defaultEnvironment.visible = !lounge;
    if (current.lounge) current.lounge.root.visible = !!lounge;
    current.world = lounge?.world ?? new CollisionWorld();
    renderer.domElement.style.cursor = walking ? "crosshair" : "grab";
    if (!walking && firstPerson.isLocked) firstPerson.unlock();
    if (walking || lounge) {
      const dimensions = box.getSize(new THREE.Vector3());
      const scale = firstPersonHeight === undefined
        ? 1.2 / Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001)
        : firstPersonHeight / Math.max(dimensions.y, 0.001);
      group.scale.setScalar(scale);
      group.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      // Cover the complete rest footprint (including paws/tail); an extra
      // margin leaves room for the character's breathing and gesture poses.
      current.subjectRadius = Math.max(.3, Math.hypot(dimensions.x, dimensions.z) * scale * .5 + .05);
      camera.fov = 65; camera.near = 0.05; camera.far = 150;
      if (firstPersonHeight === undefined) {
        camera.position.set(0, EYE_HEIGHT, 3);
        camera.lookAt(0, 0.6, 0);
      } else {
        // These humans face +X. Start directly in front of them with a level
        // gaze so their eye heights are relative to the user's 1.6-unit eyes.
        camera.position.set(3, EYE_HEIGHT, 0);
        camera.lookAt(0, EYE_HEIGHT, 0);
      }
      if (lounge) {
        try {
          const spawn = model.current ? loungeSpawns(lounge, current.subjectRadius) : (() => {
            const player = lounge.world.nearest(new THREE.Vector3().fromArray(lounge.data.spawn.player), PLAYER_RADIUS);
            if (!player) throw new Error("There is no safe place to enter this environment.");
            return { player, subject: player.clone() };
          })();
          actor.position.copy(spawn.subject);
          camera.position.copy(spawn.player); camera.position.y += EYE_HEIGHT;
          const gaze = new THREE.Vector3().fromArray(lounge.data.spawn.lookDirection).multiplyScalar(2).add(spawn.player);
          gaze.y = camera.position.y - .5;
          camera.lookAt(gaze);
          setEnvironmentStatus("");
        } catch (error) {
          current.ready = false;
          setEnvironmentStatus(error instanceof Error ? error.message : "The character cannot fit in the study lounge.");
        }
      }
      lifelike.current?.setWorld(current.world, current.subjectRadius);
      fetchGame.current?.setWorld(current.world, current.subjectRadius, lounge?.root ?? null);
      if (!walking) {
        orbit.target.copy(model.current ? actor.position.clone().add(new THREE.Vector3(0, .8, 0))
          : new THREE.Vector3().fromArray(lounge!.data.spawn.lookDirection).multiplyScalar(2).add(camera.position));
        orbit.update();
      }
      renderer.setClearColor(0xf1f1f1);
    } else {
      if (firstPerson.isLocked) firstPerson.unlock();
      group.scale.setScalar(1); group.position.set(0, 0, 0);
      camera.fov = 45; camera.near = size / 1000; camera.far = size * 100;
      camera.position.copy(center).add(new THREE.Vector3(size, size * 0.6, size));
      orbit.target.copy(center); orbit.update();
      renderer.setClearColor(0xf6f6f6);
    }
    group.updateMatrixWorld(true); camera.updateProjectionMatrix();
  }, [view, loaded, environmentId, environmentRevision, url]);

  useEffect(() => {
    activeRef.current = active;
    keys.current.clear(); handFrame.current = null;
    const current = viewScene.current;
    if (!current) return;
    current.orbit.enabled = active && !walkingView(view);
    current.firstPerson.enabled = active && walkingView(view);
    current.renderer.domElement.style.cursor = !active ? "default" : walkingView(view) ? "crosshair" : "grab";
    if (!active && current.firstPerson.isLocked) current.firstPerson.unlock();
    if (!active) { fetchGame.current?.clear(false); setBehaviorAction(""); behaviorRef.current = ""; }
    if (active && view === "lifelike" && current.ready) lifelike.current?.activate(performance.now());
  }, [active, view, loaded, environmentId, environmentRevision]);

  useEffect(() => {
    if (view === "lifelike") return;
    if (view === "model") { player.current?.stop(); return; }
    if (animation) player.current?.play(animation);
    else player.current?.stop();
  }, [animation, animations, view]);

  useEffect(() => {
    if (view !== "lifelike") player.current?.setPlayback(playing, speed);
  }, [playing, speed, animations, view]);

  useEffect(() => { if (rig.current) rig.current.helper.visible = skeleton && !walkingView(view); }, [skeleton, boneNames, view]);
  useEffect(() => {
    model.current?.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => { if ("wireframe" in material) material.wireframe = wireframe && view !== "lifelike"; });
      }
    });
  }, [wireframe, boneNames, view]);

  function rotate(next: typeof angles) {
    setAngles(next);
    const current = rig.current;
    if (!current?.bones[boneIndex]) return;
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(next.x), THREE.MathUtils.degToRad(next.y), THREE.MathUtils.degToRad(next.z),
    ));
    current.bones[boneIndex].quaternion.copy(current.rest[boneIndex]).multiply(rotation);
  }

  function reset() {
    rig.current?.bones.forEach((bone, index) => bone.quaternion.copy(rig.current!.rest[index]));
    setAngles({ x: 0, y: 0, z: 0 });
  }

  useEffect(() => {
    if (view === "model") setAnimation("");
    else if (view === "animation" && !animation) setAnimation(animations[0]?.name || "");
  }, [view, animations]);

  const selectedAnimation = animations.find(clip => clip.name === animation);
  return <>
    <p className="viewer-instructions muted">{!active ? "Scene paused · choose your settings, then click View" : walkingView(view)
      ? "Click the scene to explore · WASD to move · mouse to look · Esc to release"
      : "Drag to orbit · scroll to zoom · right-drag to pan"}</p>
    <div className="viewer" aria-label="Interactive 3D scene">
      <div className="viewer-scene" ref={container} />
      {active && walkingView(view) && modelLoaded && <FirstPersonHands navigationError={navigationError} onHands={onHands}
        behaviorAction={behaviorAction} />}
    </div>
    {active && walkingView(view) && modelLoaded && <p className="muted">B: spawn / recall ball · Pinch, move, and release to throw · Pinch the returned ball to take it · C: clear</p>}
    {environmentStatus && <p role="status">{environmentStatus}</p>}
    {message && (!walkingView(view) || !modelLoaded) && <p className="muted" role="status">{message}</p>}
    {!url && <p className="muted">{walkingView(view) ? "Exploring without a model." : "Select First person or Lifelike to walk through the environment."}</p>}
    {!modelLoaded && navigationError && <p className="error" role="alert">{navigationError}</p>}
    {modelLoaded && view === "animation" && !animations.length && <p className="muted">This model has no animation clips.</p>}
    {active && animations.length > 0 && view === "animation" && <div className="row">
      <label>Animation <select value={animation} onChange={event => setAnimation(event.target.value)}>
        <option value="">Rest pose</option>
        {animations.map(clip => <option key={clip.name} value={clip.name}>{clip.name}</option>)}
      </select></label>
      <button disabled={!animation} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
      <button disabled={!animation} onClick={() => { player.current?.play(animation); setPlaying(true); }}>Replay</button>
      <label>Speed <select value={speed} onChange={event => setSpeed(Number(event.target.value))}>
        <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
      </select></label>
    </div>}
    {active && selectedAnimation && view === "animation" && <p className="muted">
      {selectedAnimation.duration.toFixed(1)} s · {selectedAnimation.loop ? "Loop" : "Plays once"}
      {selectedAnimation.description && ` · ${selectedAnimation.description}`}
    </p>}
    {active && modelLoaded && !walkingView(view) && <div className="row">
      <label><input type="checkbox" checked={wireframe} onChange={event => setWireframe(event.target.checked)} /> Wireframe</label>
      <label><input type="checkbox" checked={skeleton} onChange={event => setSkeleton(event.target.checked)} /> Skeleton</label>
    </div>}
    {active && boneNames.length > 0 && view === "model" && <>
      <div className="row">
        <label>Joint <select disabled={!!animation} value={boneIndex} onChange={event => {
          reset(); setBoneIndex(Number(event.target.value));
        }}>{boneNames.map((name, index) => <option key={index} value={index}>{name}</option>)}</select></label>
        <button disabled={!!animation} onClick={reset}>Reset pose</button>
      </div>
      <div className="row">
        {(["x", "y", "z"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}
          <input disabled={!!animation} type="range" min={-90} max={90} value={angles[axis]} onChange={event => rotate({ ...angles, [axis]: Number(event.target.value) })} /> {angles[axis]}°
        </label>)}
      </div>
      <p className="muted">{animation ? "Select Rest pose to rotate joints manually. " : ""}Pose controls only affect this preview; downloads keep the original rig.</p>
    </>}
  </>;
}
