import * as THREE from "three";
import type { Vec2 } from "../hands/types";
import type { PlacedHand } from "./handDepth";
import { BALL_RADIUS, type World } from "./world";

export type Vec3Like = { x: number; y: number; z: number };

export type InteractionEvent =
    | { type: "grab"; handId: number; target: "ball" | "none" }
    | { type: "release"; handId: number; position: Vec3Like }
    | { type: "throw"; handId: number; position: Vec3Like; velocity: Vec3Like }
    | { type: "landed"; position: Vec3Like }
    | { type: "returned" }
    | { type: "pet"; handId: number; strength: number; screen: Vec2 };

type BallState = "docked" | "held" | "flying";

/** How far (m) hand depth may differ from the ball's or dog's depth and still touch it. */
const BALL_DEPTH_TOLERANCE = 0.3;
const DOG_DEPTH_TOLERANCE = 0.45;

const GRAVITY = 9.80665;
const BOUNCE = 0.55;
const ROLL_DAMPING = 1.2;
const AIR_DRAG = 0.05;

/** Throw tuning. Hand speed is measured in hand-lengths/s so it doesn't depend on camera distance. */
const THROW_MIN_SPEED = 3.5;
const THROW_MIN_GROWTH = 1.2;
const THROW_LATERAL = 0.213;
const THROW_VERTICAL = 0.267;
const THROW_FORWARD_FROM_SPEED = 0.3;
const THROW_FORWARD_FROM_GROWTH = 1.467;
const THROW_MAX_SPEED = 10.67;

const REST_RETURN_S = 1.2;
const MAX_FLIGHT_S = 10;
const BOUNDS = 45;

const PET_MIN_SPEED = 2;
const PET_EVENT_INTERVAL_MS = 150;

type HandState = { closed: boolean; lastPetAt: number };

function gripPoint(hand: PlacedHand): Vec2 {
    return hand.pose === "pinch" ? hand.pinchPoint : hand.palm;
}

export class Interactions {
    state: BallState = "docked";
    heldBy: number | null = null;
    hoveringBall = false;
    petLevel = 0;
    pettingHands = new Set<number>();
    /** Screen positions where hearts should spawn this frame. */
    heartSpawns: Vec2[] = [];

    readonly position = new THREE.Vector3();
    readonly velocity = new THREE.Vector3();

    private restTime = 0;
    private flightTime = 0;
    private landed = false;
    private popIn = 1;
    private lastHeartAt = 0;
    private handStates = new Map<number, HandState>();
    private listeners: ((e: InteractionEvent) => void)[] = [];
    private readonly world: World;
    private readonly target = new THREE.Vector3();
    private readonly spinAxis = new THREE.Vector3();
    private readonly up = new THREE.Vector3(0, 1, 0);

    constructor(world: World) {
        this.world = world;
        this.dock();
    }

    on(listener: (e: InteractionEvent) => void): void {
        this.listeners.push(listener);
    }

    private emit(e: InteractionEvent): void {
        for (const l of this.listeners) l(e);
    }

    dock(): void {
        this.state = "docked";
        this.heldBy = null;
        this.position.copy(this.world.ballRest);
        this.velocity.set(0, 0, 0);
        this.popIn = 0;
        this.world.clearTrail();
    }

    private canReachBall(hand: PlacedHand, grip: Vec2): boolean {
        const s = this.world.project(this.position);
        if (Math.abs(s.depth - hand.distance) > BALL_DEPTH_TOLERANCE)
            return false;
        const r = this.world.screenRadius(this.position, BALL_RADIUS);
        return Math.hypot(s.x - grip.x, s.y - grip.y) < r + hand.size * 0.6;
    }

    update(hands: PlacedHand[], dt: number, nowMs: number): void {
        this.hoveringBall = false;
        this.pettingHands.clear();
        this.heartSpawns = [];
        const dogRect = this.world.dogScreenRect();

        for (const hand of hands) {
            let hs = this.handStates.get(hand.id);
            if (!hs) {
                hs = { closed: false, lastPetAt: 0 };
                this.handStates.set(hand.id, hs);
            }
            // A stale hand counts as open so a throw that outruns tracking still releases.
            const closed = hand.closed && !hand.stale;
            const grip = gripPoint(hand);

            if (closed && !hs.closed) {
                const grabbed =
                    this.state !== "held" && this.canReachBall(hand, grip);
                if (grabbed) {
                    this.state = "held";
                    this.heldBy = hand.id;
                    this.world.clearTrail();
                }
                this.emit({
                    type: "grab",
                    handId: hand.id,
                    target: grabbed ? "ball" : "none",
                });
            } else if (!closed && hs.closed && this.heldBy === hand.id) {
                this.release(hand);
            }
            hs.closed = closed;

            if (this.heldBy === hand.id) {
                // Sit the ball just beyond the grip so the fingers overlap it.
                this.world.rayPoint(
                    grip,
                    hand.distance + BALL_RADIUS,
                    this.target,
                );
                this.position.lerp(this.target, 1 - Math.exp(-dt * 30));
            } else if (
                !closed &&
                !hand.stale &&
                this.state !== "held" &&
                this.canReachBall(hand, grip)
            ) {
                this.hoveringBall = true;
            }

            this.updatePetting(hand, hs, closed, dogRect, nowMs, dt);
        }

        const live = new Set(hands.map((h) => h.id));
        for (const id of this.handStates.keys())
            if (!live.has(id)) this.handStates.delete(id);
        if (this.heldBy !== null && !live.has(this.heldBy)) {
            this.heldBy = null;
            this.state = "flying";
            this.velocity.set(0, 0, 0);
        }

        this.petLevel = Math.max(0, this.petLevel - dt * 0.25);
        this.stepBall(dt);
        this.syncMesh(dt);
    }

    private updatePetting(
        hand: PlacedHand,
        hs: HandState,
        closed: boolean,
        rect: { x: number; y: number; width: number; height: number },
        nowMs: number,
        dt: number,
    ): void {
        if (closed || hand.stale || hand.pose !== "open") return;
        if (
            Math.abs(hand.distance - this.world.dogDistance()) >
            DOG_DEPTH_TOLERANCE
        )
            return;
        const dx = (hand.palm.x - (rect.x + rect.width / 2)) / (rect.width / 2);
        const dy =
            (hand.palm.y - (rect.y + rect.height / 2)) / (rect.height / 2);
        if (dx * dx + dy * dy > 1) return;
        const speed =
            Math.hypot(hand.velocity.x, hand.velocity.y) /
            Math.max(hand.handLengthPx, 1);
        if (speed < PET_MIN_SPEED) return;

        this.pettingHands.add(hand.id);
        this.petLevel = Math.min(1, this.petLevel + speed * dt * 0.08);
        if (nowMs - hs.lastPetAt > PET_EVENT_INTERVAL_MS) {
            hs.lastPetAt = nowMs;
            this.emit({
                type: "pet",
                handId: hand.id,
                strength: this.petLevel,
                screen: hand.palm,
            });
        }
        if (nowMs - this.lastHeartAt > 200) {
            this.lastHeartAt = nowMs;
            this.heartSpawns.push(hand.palm);
        }
    }

    private release(hand: PlacedHand): void {
        this.heldBy = null;
        this.state = "flying";
        this.flightTime = 0;
        this.landed = false;

        const size = Math.max(hand.handLengthPx, 1);
        const vx = hand.velocity.x / size;
        const vy = hand.velocity.y / size;
        const speed = Math.hypot(vx, vy);
        const growth = Math.max(0, hand.growth);
        const position = {
            x: this.position.x,
            y: this.position.y,
            z: this.position.z,
        };

        if (speed < THROW_MIN_SPEED && growth < THROW_MIN_GROWTH) {
            this.velocity.set(
                vx * THROW_LATERAL * 0.4,
                -vy * THROW_VERTICAL * 0.4,
                0,
            );
            this.emit({ type: "release", handId: hand.id, position });
            return;
        }

        // Camera looks down -Z with no yaw, so screen right is +X and "into the screen" is -Z.
        const forward =
            THROW_FORWARD_FROM_SPEED * speed +
            THROW_FORWARD_FROM_GROWTH * growth;
        this.velocity.set(vx * THROW_LATERAL, -vy * THROW_VERTICAL, -forward);
        if (this.velocity.length() > THROW_MAX_SPEED)
            this.velocity.setLength(THROW_MAX_SPEED);
        this.emit({
            type: "throw",
            handId: hand.id,
            position,
            velocity: {
                x: this.velocity.x,
                y: this.velocity.y,
                z: this.velocity.z,
            },
        });
    }

    private stepBall(dt: number): void {
        if (this.state !== "flying") return;
        this.flightTime += dt;

        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / steps;
        const p = this.position;
        const v = this.velocity;
        const rest = this.world.ballRest;
        let onGround = false;

        for (let i = 0; i < steps; i++) {
            v.y -= GRAVITY * h;
            v.multiplyScalar(1 - AIR_DRAG * h);
            p.addScaledVector(v, h);

            // Land back on the stand top if dropped onto it.
            const standDist = Math.hypot(p.x - rest.x, p.z - rest.z);
            if (
                standDist < 0.08 &&
                p.y < rest.y &&
                p.y > rest.y - 0.08 &&
                v.y < 0
            ) {
                p.y = rest.y;
                v.y = Math.abs(v.y) < 0.6 ? 0 : -v.y * BOUNCE;
            }

            if (p.y < BALL_RADIUS) {
                p.y = BALL_RADIUS;
                if (!this.landed) {
                    this.landed = true;
                    this.emit({
                        type: "landed",
                        position: { x: p.x, y: p.y, z: p.z },
                    });
                }
                v.y = Math.abs(v.y) < 0.6 ? 0 : -v.y * BOUNCE;
                const damp = Math.exp(-ROLL_DAMPING * h);
                v.x *= damp;
                v.z *= damp;
                onGround = true;
            }
        }

        const resting = onGround && v.lengthSq() < 0.02;
        this.restTime = resting ? this.restTime + dt : 0;
        const outOfBounds = Math.abs(p.x) > BOUNDS || Math.abs(p.z) > BOUNDS;
        if (
            this.restTime > REST_RETURN_S ||
            this.flightTime > MAX_FLIGHT_S ||
            outOfBounds
        ) {
            this.dock();
            this.emit({ type: "returned" });
        }
    }

    private syncMesh(dt: number): void {
        const mesh = this.world.ball;
        mesh.position.copy(this.position);

        this.popIn = Math.min(1, this.popIn + dt * 4);
        const s = 1 - Math.pow(1 - this.popIn, 3);
        mesh.scale.setScalar(Math.max(0.001, s));

        if (this.state === "flying") {
            this.world.pushTrail(this.position);
            const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
            if (horizontal > 1e-3) {
                this.spinAxis
                    .set(this.velocity.x, 0, this.velocity.z)
                    .cross(this.up)
                    .normalize()
                    .negate();
                mesh.rotateOnWorldAxis(
                    this.spinAxis,
                    (horizontal / BALL_RADIUS) * dt,
                );
            }
        }

        const mat = mesh.material;
        if (this.state === "held") mat.emissive.set("#6b4a00");
        else if (this.hoveringBall) mat.emissive.set("#3a3a3a");
        else mat.emissive.set("#000000");
    }
}
