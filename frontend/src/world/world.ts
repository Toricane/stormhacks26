import * as THREE from "three";
import type { Vec2 } from "../hands/types";

export const EYE_HEIGHT = 1.4;
export const BALL_RADIUS = 0.045;
const FOV_DEG = 55;
const GROUND_SIZE = 200;
const SKY_COLOR = new THREE.Color("#7fb2e0");
const HORIZON_COLOR = new THREE.Color("#dbe9f1");
const TRAIL_POINTS = 40;

/** Screen-space rectangle in CSS px. */
export type ScreenRect = { x: number; y: number; width: number; height: number };

function gridTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#79a35a";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#6b9450";
  g.fillRect(0, 0, 128, 3);
  g.fillRect(0, 0, 3, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GROUND_SIZE, GROUND_SIZE);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(150, 32, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 150);
    c.copy(HORIZON_COLOR).lerp(SKY_COLOR, Math.pow(t, 0.6));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 300);
  readonly ball: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  readonly ballRest: THREE.Vector3;
  readonly dog: THREE.Group;
  readonly dogBounds = new THREE.Box3();
  /** Camera view direction (unit vector). */
  readonly forward = new THREE.Vector3();

  private readonly trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly trailPositions = new Float32Array(TRAIL_POINTS * 3);
  private trailCount = 0;
  private width = 1;
  private height = 1;
  private readonly tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.camera.lookAt(0, 0.95, -3);
    this.camera.getWorldDirection(this.forward);

    this.scene.fog = new THREE.Fog(HORIZON_COLOR, 15, 90);
    this.scene.add(skyDome());

    this.scene.add(new THREE.HemisphereLight("#e4f1ff", "#5f7d45", 1.2));
    const sun = new THREE.DirectionalLight("#fff6e8", 2.2);
    sun.position.set(4, 10, 2);
    sun.target.position.set(0, 0, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshLambertMaterial({ map: gridTexture(this.renderer) }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const standHeight = 0.95;
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.11, standHeight, 24),
      new THREE.MeshStandardMaterial({ color: "#d9d2c5", roughness: 0.8 }),
    );
    stand.position.set(0.32, standHeight / 2, -0.85);
    stand.castShadow = true;
    stand.receiveShadow = true;
    this.scene.add(stand);
    this.ballRest = new THREE.Vector3(0.32, standHeight + BALL_RADIUS, -0.85);

    this.dog = this.createDogPlaceholder();
    this.scene.add(this.dog);
    this.dog.updateMatrixWorld(true);
    for (const child of this.dog.children) {
      if (child.userData.solid) this.dogBounds.expandByObject(child);
    }

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
      new THREE.MeshStandardMaterial({ color: "#c9e34b", roughness: 0.55 }),
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55 }),
    );
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
  }

  private createDogPlaceholder(): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: "#c79a62", roughness: 0.9, transparent: true, opacity: 0.85 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.38, 6, 16), mat);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.32;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), mat);
    head.position.set(-0.32, 0.5, 0);
    for (const m of [body, head]) {
      m.castShadow = true;
      m.userData.solid = true;
      group.add(m);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.55, 48),
      new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, opacity: 0.6 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    group.add(ring);
    group.position.set(-0.15, 0, -1.3);
    group.rotation.y = -0.35;
    return group;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Focal length in CSS px for the vertical field of view. */
  focalPx(): number {
    return this.height / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
  }

  project(p: THREE.Vector3): Vec2 & { depth: number } {
    const v = this.tmp.copy(p).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.width,
      y: ((1 - v.y) / 2) * this.height,
      depth: p.distanceTo(this.camera.position),
    };
  }

  /** World point `distance` meters from the eye along the ray through a screen point. */
  rayPoint(screen: Vec2, distance: number, out = new THREE.Vector3()): THREE.Vector3 {
    out.set((screen.x / this.width) * 2 - 1, 1 - (screen.y / this.height) * 2, 0.5).unproject(this.camera);
    out.sub(this.camera.position).normalize().multiplyScalar(distance).add(this.camera.position);
    return out;
  }

  screenRadius(p: THREE.Vector3, radius: number): number {
    return (radius * this.focalPx()) / Math.max(0.05, p.distanceTo(this.camera.position));
  }

  dogDistance(): number {
    return this.dogBounds.getCenter(this.tmp).distanceTo(this.camera.position);
  }

  dogScreenRect(): ScreenRect {
    const b = this.dogBounds;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      const s = this.project(corner);
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x);
      maxY = Math.max(maxY, s.y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  pushTrail(p: THREE.Vector3): void {
    if (this.trailCount === TRAIL_POINTS) {
      this.trailPositions.copyWithin(0, 3);
      this.trailCount -= 1;
    }
    p.toArray(this.trailPositions, this.trailCount * 3);
    this.trailCount += 1;
    this.trail.geometry.setDrawRange(0, this.trailCount);
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  clearTrail(): void {
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
