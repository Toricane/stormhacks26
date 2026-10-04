"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { EYE_HEIGHT, moveFirstPerson } from "@/lib/first-person";

type Rig = { bones: THREE.Bone[]; rest: THREE.Quaternion[]; helper: THREE.SkeletonHelper };
type View = "model" | "animation" | "firstPerson";
type ViewScene = {
  camera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  firstPerson: PointerLockControls;
  renderer: THREE.WebGLRenderer;
  group: THREE.Group;
  environment: THREE.Group;
  grid: THREE.GridHelper;
  box: THREE.Box3;
  center: THREE.Vector3;
  size: number;
};

function dispose(root: THREE.Object3D) {
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        Object.values(material).forEach(value => { if (value instanceof THREE.Texture) value.dispose(); });
        material.dispose();
      }
    }
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
}

export default function Viewer({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const model = useRef<THREE.Object3D | null>(null);
  const rig = useRef<Rig | null>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const clips = useRef<THREE.AnimationClip[]>([]);
  const viewScene = useRef<ViewScene | null>(null);
  const keys = useRef(new Set<string>());
  const viewRef = useRef<View>("model");
  const [view, setView] = useState<View>("model");
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [animationNames, setAnimationNames] = useState<string[]>([]);
  const [animation, setAnimation] = useState("");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [boneNames, setBoneNames] = useState<string[]>([]);
  const [boneIndex, setBoneIndex] = useState(0);
  const [angles, setAngles] = useState({ x: 0, y: 0, z: 0 });
  const [skeleton, setSkeleton] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [message, setMessage] = useState("Loading model…");

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
    const onLock = () => { if (!closed) { setLocked(true); setNavigationError(""); } };
    const onUnlock = () => { keys.current.clear(); if (!closed) setLocked(false); };
    const onLockError = () => { if (!closed) setNavigationError("Mouse capture failed. Click the canvas again to enter."); };
    const enter = () => {
      if (viewRef.current !== "firstPerson" || !viewScene.current) return;
      if (!renderer.domElement.requestPointerLock) {
        setNavigationError("This browser does not support mouse capture.");
        return;
      }
      Promise.resolve(renderer.domElement.requestPointerLock()).catch(onLockError);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (viewRef.current !== "firstPerson" || !firstPerson.isLocked) return;
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
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host); resize();
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Model download failed.");
        const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
        if (closed) { dispose(gltf.scene); return; }
        const root = gltf.scene;
        model.current = root;
        const group = new THREE.Group();
        group.add(root); scene.add(group); root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.1);
        camera.near = size / 1000; camera.far = size * 100;
        camera.position.copy(center).add(new THREE.Vector3(size, size * 0.6, size));
        camera.updateProjectionMatrix(); controls.target.copy(center); controls.update();
        const grid = new THREE.GridHelper(size * 3, 20, 0xaaaaaa, 0xdddddd);
        grid.position.set(center.x, box.min.y, center.z); scene.add(grid);
        const environment = new THREE.Group();
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
        ground.rotation.x = -Math.PI / 2; ground.position.y = -0.001;
        environment.add(ground, new THREE.GridHelper(100, 100, 0xaaaaaa, 0xcccccc));
        environment.visible = false; scene.add(environment);
        viewScene.current = { camera, orbit: controls, firstPerson, renderer, group, environment, grid, box, center, size };
        const bones: THREE.Bone[] = [];
        root.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
        const helper = new THREE.SkeletonHelper(root);
        const material = helper.material as THREE.LineBasicMaterial;
        material.depthTest = false; helper.renderOrder = 10;
        scene.add(helper);
        rig.current = { bones, rest: bones.map(bone => bone.quaternion.clone()), helper };
        clips.current = gltf.animations;
        mixer.current = new THREE.AnimationMixer(root);
        setAnimationNames(gltf.animations.map(clip => clip.name));
        setAnimation(gltf.animations[0]?.name || "");
        setBoneNames(bones.map((bone, index) => bone.name || `Bone ${index + 1}`));
        setMessage(bones.length ? `${bones.length} bones. Rotate a joint to inspect skin deformation.` : "Static mesh. Select the Auto rig model to check deformation.");
        setView(gltf.animations.length ? "animation" : "model");
        setLoaded(true);
      } catch (error) {
        if (!closed) setMessage(error instanceof Error ? error.message : "Could not load model.");
      }
    }
    void load();
    let previousTime = performance.now();
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      mixer.current?.update(delta);
      previousTime = time;
      if (viewRef.current === "firstPerson") {
        if (firstPerson.isLocked) moveFirstPerson(firstPerson, keys.current, delta);
        camera.position.y = EYE_HEIGHT;
      } else controls.update();
      renderer.render(scene, camera);
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
      observer.disconnect(); controls.dispose(); dispose(scene); renderer.dispose();
      mixer.current?.stopAllAction();
      if (model.current) mixer.current?.uncacheRoot(model.current);
      mixer.current = null; clips.current = [];
      viewScene.current = null;
      renderer.domElement.remove(); model.current = null; rig.current = null;
    };
  }, [url]);

  useEffect(() => {
    viewRef.current = view;
    keys.current.clear(); setNavigationError("");
    const current = viewScene.current;
    if (!current) return;
    const { camera, orbit, firstPerson, renderer, group, environment, grid, box, center, size } = current;
    const walking = view === "firstPerson";
    orbit.enabled = !walking; firstPerson.enabled = walking;
    environment.visible = walking; grid.visible = !walking;
    renderer.domElement.style.cursor = walking ? "crosshair" : "grab";
    if (walking) {
      const dimensions = box.getSize(new THREE.Vector3());
      const scale = 1.2 / Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001);
      group.scale.setScalar(scale);
      group.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      camera.fov = 65; camera.near = 0.05; camera.far = 150;
      camera.position.set(0, EYE_HEIGHT, 3);
      camera.lookAt(0, 0.6, 0);
      renderer.setClearColor(0xe6edf4);
    } else {
      if (firstPerson.isLocked) firstPerson.unlock();
      group.scale.setScalar(1); group.position.set(0, 0, 0);
      camera.fov = 45; camera.near = size / 1000; camera.far = size * 100;
      camera.position.copy(center).add(new THREE.Vector3(size, size * 0.6, size));
      orbit.target.copy(center); orbit.update();
      renderer.setClearColor(0xf6f6f6);
    }
    group.updateMatrixWorld(true); camera.updateProjectionMatrix();
  }, [view, loaded]);

  useEffect(() => {
    mixer.current?.stopAllAction();
    const clip = clips.current.find(clip => clip.name === animation);
    if (clip) mixer.current?.clipAction(clip).reset().play();
  }, [animation, animationNames]);

  useEffect(() => {
    if (mixer.current) mixer.current.timeScale = playing ? speed : 0;
  }, [playing, speed, animationNames]);

  useEffect(() => { if (rig.current) rig.current.helper.visible = skeleton && view !== "firstPerson"; }, [skeleton, boneNames, view]);
  useEffect(() => {
    model.current?.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => { if ("wireframe" in material) material.wireframe = wireframe; });
      }
    });
  }, [wireframe, boneNames]);

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

  function changeView(next: View) {
    setView(next);
    if (next === "model") setAnimation("");
    else if (next === "animation" && !animation) setAnimation(animationNames[0] || "");
  }

  return <>
    <p className="muted">{view === "firstPerson"
      ? locked ? "WASD to move · mouse to look · Esc to release mouse" : "Click the canvas to enter · WASD to move · mouse to look · Esc to release"
      : "Drag to orbit · scroll to zoom · right-drag to pan"}</p>
    <div className="viewer" ref={container} aria-label="Interactive 3D model viewer" />
    <p role="status">{message}</p>
    {navigationError && <p className="error" role="alert">{navigationError}</p>}
    {animationNames.length > 0 && view !== "model" && <div className="row">
      <label>Animation <select value={animation} onChange={event => setAnimation(event.target.value)}>
        <option value="">Rest pose</option>
        {animationNames.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <button disabled={!animation} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
      <label>Speed <select value={speed} onChange={event => setSpeed(Number(event.target.value))}>
        <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
      </select></label>
    </div>}
    {view !== "firstPerson" && <div className="row">
      <label><input type="checkbox" checked={wireframe} onChange={event => setWireframe(event.target.checked)} /> Wireframe</label>
      <label><input type="checkbox" checked={skeleton} onChange={event => setSkeleton(event.target.checked)} /> Skeleton</label>
    </div>}
    {boneNames.length > 0 && view === "model" && <>
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
    {loaded && <div className="row" aria-label="View options">
      <span>View</span>
      <button aria-pressed={view === "model"} onClick={() => changeView("model")}>Model</button>
      <button aria-pressed={view === "animation"} disabled={!animationNames.length} onClick={() => changeView("animation")}>Animation</button>
      <button aria-pressed={view === "firstPerson"} onClick={() => changeView("firstPerson")}>First person</button>
    </div>}
  </>;
}
