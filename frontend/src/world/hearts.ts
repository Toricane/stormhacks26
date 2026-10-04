import type { Vec2 } from "../hands/types";

type Heart = { x: number; y: number; vx: number; vy: number; life: number; size: number };

const MAX_HEARTS = 60;

export class Hearts {
  private hearts: Heart[] = [];

  spawn(at: Vec2): void {
    if (this.hearts.length >= MAX_HEARTS) this.hearts.shift();
    this.hearts.push({
      x: at.x + (Math.random() - 0.5) * 40,
      y: at.y - 20,
      vx: (Math.random() - 0.5) * 60,
      vy: -120 - Math.random() * 80,
      life: 1,
      size: 14 + Math.random() * 10,
    });
  }

  step(dt: number): void {
    for (const h of this.hearts) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.life -= dt * 0.9;
    }
    this.hearts = this.hearts.filter((h) => h.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = "#ff6f91";
    for (const h of this.hearts) {
      const s = h.size;
      ctx.globalAlpha = h.life;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y + s / 4);
      ctx.bezierCurveTo(h.x, h.y, h.x - s / 2, h.y, h.x - s / 2, h.y + s / 4);
      ctx.bezierCurveTo(h.x - s / 2, h.y + s / 2, h.x, h.y + s * 0.6, h.x, h.y + s * 0.85);
      ctx.bezierCurveTo(h.x, h.y + s * 0.6, h.x + s / 2, h.y + s / 2, h.x + s / 2, h.y + s / 4);
      ctx.bezierCurveTo(h.x + s / 2, h.y, h.x, h.y, h.x, h.y + s / 4);
      ctx.fill();
    }
    ctx.restore();
  }
}
