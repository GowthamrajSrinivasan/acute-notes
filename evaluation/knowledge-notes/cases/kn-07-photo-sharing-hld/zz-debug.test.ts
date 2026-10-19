// TEMPORARY layout debug helper (deleted after authoring).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { renderVisualPlan } from "@/ai/renderer/render";
import { checkProposal } from "@/ai/changes/proposalGeometry";

const CASE = process.env.DEBUG_CASE ?? "kn-07-photo-sharing-hld";
it("debug layout", async () => {
  const raw = JSON.parse(readFileSync(process.env.DEBUG_PLAN ?? join(__dirname, "..", CASE, "reference", "plan.json"), "utf8"));
  const v = validateVisualPlan(raw);
  console.log("losses", v.losses, "warnings", v.warnings);
  const plan = v.plan;
  console.log(plan.relationships.map((r, i) => `__rel${i} ${r.from}->${r.to}`).join(" | "));
  const set = await renderVisualPlan(plan, {
    operationId: "golden",
    title: "Golden dataset",
    metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "golden", operationId: "golden" },
    context: { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 1000 } },
    parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }],
  });
  for (const c of set.changes) {
    const b = (c as { box?: { x: number; y: number; width: number; height: number } }).box;
    if (b && (c.kind === "create_frame" || (process.env.DEBUG_ALL && (c.kind === "create_shape" || c.kind === "create_block")))) console.log(c.kind, (c as { key: string }).key, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height));
  }
  const layout = checkProposal(set.changes, []);
  for (const i of layout.issues) if (i.severity === "fatal") console.log(i.severity, i.code, i.evidence);
  console.log(layout.counts);
});
