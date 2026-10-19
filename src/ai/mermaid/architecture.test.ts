/**
 * Mermaid `architecture-beta` → interactive architecture plans: icons become kinds, groups become diagram sections,
 * arrows keep their direction, and junctions fold into direct links.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { renderVisualPlan } from "@/ai/renderer/render";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { convertMermaid } from "./convert";

const convert = (source: string) => {
  const r = convertMermaid(source);
  if (!r.ok) throw new Error(r.error.message);
  return r;
};
const shape = (plan: VisualPlan, id: string) => plan.nodes.find((n): n is Extract<VisualNode, { type: "shape" }> => n.id === id && n.type === "shape");

const DOCS_EXAMPLE = `architecture-beta
    group api(cloud)[API]

    service db(database)[Database] in api
    service disk1(disk)[Storage] in api
    service disk2(disk)[Storage] in api
    service server(server)[Server] in api

    db:L -- R:server
    disk1:T -- B:server
    disk2:T -- B:db`;

describe("Mermaid architecture-beta", () => {
  it("converts the Mermaid docs example: icons → kinds, the group → a diagram section", () => {
    const { plan, kind } = convert(DOCS_EXAMPLE);
    expect(kind).toBe("architecture");
    expect(plan.template).toBe("sectioned");
    const group = plan.nodes.find((n) => n.type === "group");
    expect(group).toMatchObject({ id: "api", content: { label: "API", diagram: "architecture" } });
    expect(shape(plan, "db")?.content).toMatchObject({ shape: "cylinder", kind: "database", label: "Database" });
    expect(shape(plan, "disk1")?.content).toMatchObject({ shape: "cylinder", kind: "database" });
    expect(shape(plan, "server")?.content).toMatchObject({ shape: "rectangle", kind: "backend" });
    expect(plan.nodes.filter((n) => n.type === "shape").every((n) => n.parent === "api")).toBe(true);
    expect(plan.relationships).toEqual([
      { from: "db", to: "server", type: "relates_to" },
      { from: "disk1", to: "server", type: "relates_to" },
      { from: "disk2", to: "db", type: "relates_to" },
    ]);
  });

  it("keeps arrow direction, edge labels, group endpoints and other icons", () => {
    const { plan } = convert(`architecture-beta
      title Checkout
      group edge(cloud)[Edge]
      group core(server)[Core]
      service web(internet)[Browser]
      service cdn(logos:aws-cloudfront)[CDN] in edge
      service api(server)[Order API] in core
      service q(logos:kafka-icon)[Events] in core
      web:R --> L:cdn
      cdn:R -[HTTPS]-> L:api
      q:L <-- R:api
      cdn{group}:B --> T:api{group}`);
    expect(plan.nodes[0]).toMatchObject({ type: "heading", role: "title", content: { text: "Checkout" } });
    expect(shape(plan, "web")?.content.kind).toBe("external");
    expect(shape(plan, "cdn")?.content.kind).toBe("cloud");
    expect(shape(plan, "q")?.content.kind).toBe("messagebus");
    // A service outside every group joins a section named after the diagram.
    expect(shape(plan, "web")?.parent).toBe("architecture_rest");
    expect(plan.relationships).toEqual([
      { from: "web", to: "cdn", type: "flows_to" },
      { from: "cdn", to: "api", type: "flows_to", label: "HTTPS" },
      { from: "api", to: "q", type: "flows_to" },
      { from: "edge", to: "core", type: "flows_to" },
    ]);
  });

  it("folds junctions into direct links, and notes nested groups and unknown lines", () => {
    const r = convert(`architecture-beta
      group outer(cloud)[Outer]
      group inner(server)[Inner] in outer
      service a(server)[A] in inner
      service b(database)[B] in outer
      service c(server)[C] in outer
      junction j in outer
      a:R --> L:j
      j:R --> L:b
      j:B --> T:c
      this is not a statement`);
    expect(r.plan.relationships).toEqual([
      { from: "a", to: "b", type: "flows_to" },
      { from: "a", to: "c", type: "flows_to" },
    ]);
    const warnings = r.warnings.join(" | ");
    expect(warnings).toMatch(/1 nested group is shown as its own section/);
    expect(warnings).toMatch(/1 junction folded into direct links/);
    expect(warnings).toMatch(/1 line not understood and skipped/);
  });

  it("without groups, renders as one interactive diagram frame", async () => {
    const { plan } = convert("architecture-beta\n  service web(internet)[Users]\n  service api(server)[API]\n  service db(database)[DB]\n  web:R --> L:api\n  api:R --> L:db");
    expect(plan.template).toBe("architecture");
    const set = parseChangeSet(
      await renderVisualPlan(plan, { operationId: "op", title: "Visualize", metadata: { createdBy: "import" }, context: { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } } }),
    );
    expect(set.changes.filter((c) => c.kind === "create_frame")).toHaveLength(1);
    expect(set.changes.find((c) => c.kind === "create_frame")).toHaveProperty("diagram");
  });

  it("a diagram with no services is a typed failure", () => {
    expect(convertMermaid("architecture-beta\n  group g(cloud)[Only a group]")).toMatchObject({ ok: false, error: { code: "no_nodes" } });
  });
});
