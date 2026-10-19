/** Applies a regression's mutations to a copy of a reference output, to plant one known distortion. */
import type { VisualPlan } from "@/ai/visual-plan/types";
import type { LensProjection, Mutation, ReconcileOutcome } from "./schemas";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function replaceIn(value: unknown, find: string, replace: string): { value: unknown; hits: number } {
  if (typeof value === "string") return value.includes(find) ? { value: value.split(find).join(replace), hits: 1 } : { value, hits: 0 };
  if (Array.isArray(value)) {
    let hits = 0;
    const out = value.map((v) => {
      const r = replaceIn(v, find, replace);
      hits += r.hits;
      return r.value;
    });
    return { value: out, hits };
  }
  if (value && typeof value === "object") {
    let hits = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = replaceIn(v, find, replace);
      hits += r.hits;
      out[k] = r.value;
    }
    return { value: out, hits };
  }
  return { value, hits: 0 };
}

export function mutatePlan(plan: VisualPlan, mutations: readonly Mutation[]): VisualPlan {
  const out = clone(plan);
  for (const m of mutations) {
    const rel = () => {
      if (!("from" in m)) throw new Error("no endpoints");
      const r = out.relationships.find((x) => x.from === m.from && x.to === m.to);
      if (!r) throw new Error(`mutation ${m.op}: no relationship ${m.from} → ${m.to}`);
      return r;
    };
    switch (m.op) {
      case "replace_text": {
        const i = out.nodes.findIndex((n) => n.id === m.node);
        if (i < 0) throw new Error(`mutation replace_text: no node ${m.node}`);
        const r = replaceIn(out.nodes[i]!.content, m.find, m.replace);
        if (!r.hits) throw new Error(`mutation replace_text: "${m.find}" not in ${m.node}`);
        out.nodes[i] = { ...out.nodes[i]!, content: r.value } as typeof out.nodes[number];
        break;
      }
      case "remove_node":
        if (!out.nodes.some((n) => n.id === m.node)) throw new Error(`mutation remove_node: no node ${m.node}`);
        out.nodes = out.nodes.filter((n) => n.id !== m.node);
        out.relationships = out.relationships.filter((r) => r.from !== m.node && r.to !== m.node);
        break;
      case "reverse_relationship": {
        const r = rel();
        [r.from, r.to] = [r.to, r.from];
        break;
      }
      case "set_label": {
        const r = rel();
        if (m.label === null) delete r.label;
        else r.label = m.label;
        break;
      }
      case "set_relation_type":
        rel().type = m.type;
        break;
      default:
        throw new Error(`mutation ${m.op} doesn't apply to a plan`);
    }
  }
  return out;
}

export function mutateLens(lens: LensProjection, mutations: readonly Mutation[]): LensProjection {
  const out = clone(lens);
  for (const m of mutations) {
    if (m.op === "lens_add_node") {
      const levels = out.levels.filter((x) => x.level === m.level);
      if (!levels.length) throw new Error(`mutation lens_add_node: no L${m.level} frame`);
      for (const l of levels) l.nodes.push({ ...m.node });
      continue;
    }
    if (m.op === "lens_remove_edge" || m.op === "lens_reverse_edge") {
      let hits = 0;
      for (const l of out.levels.filter((x) => x.level === m.level)) {
        const i = l.edges.findIndex((e) => e.from === m.from && e.to === m.to);
        if (i < 0) continue;
        hits++;
        if (m.op === "lens_remove_edge") l.edges.splice(i, 1);
        else l.edges[i] = { ...l.edges[i]!, from: m.to, to: m.from };
      }
      if (!hits) throw new Error(`mutation ${m.op}: no edge ${m.from} → ${m.to} at L${m.level}`);
      continue;
    }
    if (m.op !== "lens_rekey") throw new Error(`mutation ${m.op} doesn't apply to a Lens projection`);
    let hits = 0;
    for (const l of out.levels.filter((x) => x.level === m.level)) {
      for (const n of l.nodes)
        if (n.key === m.key) {
          n.key = m.newKey;
          if (m.newLabel) n.label = m.newLabel;
          hits++;
        }
      for (const e of l.edges) {
        if (e.from === m.key) e.from = m.newKey;
        if (e.to === m.key) e.to = m.newKey;
      }
    }
    for (const d of out.drills) if (d.from === m.key && out.levels.some((l) => l.level === m.level && l.nodes.some((n) => n.key === m.newKey))) d.from = m.newKey;
    if (!hits) throw new Error(`mutation lens_rekey: no ${m.key} at L${m.level}`);
  }
  return out;
}

export function mutateReconcile(outcome: ReconcileOutcome, mutations: readonly Mutation[]): ReconcileOutcome {
  const out = clone(outcome);
  for (const m of mutations) {
    if (m.op !== "reconcile_set") throw new Error(`mutation ${m.op} doesn't apply to a reconcile outcome`);
    const item = out.items.find((x) => x.key === m.item);
    if (!item) throw new Error(`mutation reconcile_set: no item ${m.item}`);
    item.state = m.state;
    if (m.text !== undefined) item.text = m.text;
  }
  return out;
}
