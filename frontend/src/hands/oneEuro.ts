function smoothingAlpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

/**
 * One Euro filter: heavy smoothing when still, low lag when moving fast.
 * https://gery.casiez.net/1euro/
 */
export class OneEuroFilter {
  private value: number | null = null;
  private derivative = 0;
  private lastT = 0;
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;

  constructor(minCutoff: number, beta: number, derivativeCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
  }

  filter(x: number, tSec: number): number {
    if (this.value === null) {
      this.value = x;
      this.lastT = tSec;
      return x;
    }
    const dt = Math.max(1e-3, tSec - this.lastT);
    this.lastT = tSec;

    const rawDerivative = (x - this.value) / dt;
    this.derivative +=
      smoothingAlpha(this.derivativeCutoff, dt) * (rawDerivative - this.derivative);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value += smoothingAlpha(cutoff, dt) * (x - this.value);
    return this.value;
  }
}
