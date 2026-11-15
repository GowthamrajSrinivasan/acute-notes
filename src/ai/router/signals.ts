/**
 * Routing signals (intelligent-update-engine-plan Stage 2d): where the user put content before. Each choice made in
 * "Where should this go?" is recorded; content that reads like an earlier one (most of its significant words shared)
 * gives that earlier destination a small boost next time — evidence, never a decision on its own.
 *
 * Bounded (the newest `MAX_SIGNALS`), per workspace; persisted by the caller through `toJSON` / `fromJSON`.
 */
import { wordOverlap } from "@/ai/fidelity/sourceUnits";

export interface RoutingSignal {
  /** The content placed (cut to `SIGNAL_CHARS`). */
  text: string;
  /** The objects chosen for it. */
  targets: string[];
  at: number;
}

export const MAX_SIGNALS = 200;
export const SIGNAL_CHARS = 1_000;
/** Shared significant words for an earlier choice to count. */
export const SIGNAL_OVERLAP = 0.5;
/** The most an earlier choice adds to a candidate's routing score. */
export const SIGNAL_BOOST = 0.1;

export class RoutingSignals {
  private signals: RoutingSignal[] = [];

  record(text: string, targets: readonly string[], at = Date.now()): void {
    if (!targets.length) return;
    this.signals.push({ text: text.slice(0, SIGNAL_CHARS), targets: [...new Set(targets)], at });
    if (this.signals.length > MAX_SIGNALS) this.signals = this.signals.slice(-MAX_SIGNALS);
  }

  /** Boost per target for content like `text` (the strongest earlier match per target). */
  boosts(text: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const s of this.signals) {
      const overlap = wordOverlap(text, s.text);
      if (overlap < SIGNAL_OVERLAP) continue;
      for (const t of s.targets) out.set(t, Math.max(out.get(t) ?? 0, SIGNAL_BOOST * overlap));
    }
    return out;
  }

  get size(): number {
    return this.signals.length;
  }

  toJSON(): RoutingSignal[] {
    return [...this.signals];
  }

  static fromJSON(raw: unknown): RoutingSignals {
    const out = new RoutingSignals();
    if (!Array.isArray(raw)) return out;
    for (const s of raw.slice(-MAX_SIGNALS)) {
      const r = s as Partial<RoutingSignal>;
      if (typeof r.text === "string" && Array.isArray(r.targets) && r.targets.every((t) => typeof t === "string") && typeof r.at === "number") {
        out.signals.push({ text: r.text.slice(0, SIGNAL_CHARS), targets: r.targets as string[], at: r.at });
      }
    }
    return out;
  }
}
