/**
 * F33 class and entity-relationship diagrams: parser → `graphToPlan` →
 * F29 validation → F30 rendering, pure.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { renderVisualPlan, type RenderContext } from "@/ai/renderer/render";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { parseClass } from "./classDiagram";
import { convertMermaid } from "./convert";
import { parseEr } from "./er";
import type { MermaidConversionResult, MermaidGraph, ParseResult } from "./types";

type Success = Extract<MermaidConversionResult, { ok: true }>;

function convert(source: string): Success {
  const r = convertMermaid(source);
  if (!r.ok) throw new Error(`expected a conversion, got ${r.error.code}: ${r.error.message}`);
  return r;
}

function graph(r: ParseResult): MermaidGraph {
  if (!r.ok) throw new Error(`expected a parse, got ${r.error.message}`);
  return r.graph;
}

const node = (plan: VisualPlan, id: string) => plan.nodes.find((n) => n.id === id) as VisualNode;
const rels = (plan: VisualPlan) => plan.relationships.map((r) => `${r.from}>${r.to}:${r.type}${r.label ? `:${r.label}` : ""}`);

const emptyContext: RenderContext = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };
const renderOptions = {
  operationId: "op_mermaid",
  title: "Convert Mermaid to canvas",
  metadata: { createdBy: "import" as const, operationId: "op_mermaid" },
  context: emptyContext,
  parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }],
};

const ANIMALS = `classDiagram
  %% the Mermaid docs example
  Animal <|-- Duck
  Animal <|-- Fish
  Animal : +int age
  Animal : +String gender
  Animal: +isMammal() bool
  class Duck{
    +String beakColor
    +swim()
  }
  class Fish {
    -int sizeInFeet
    -canEat()
  }
  class Shape
  <<interface>> Shape
  Duck ..|> Shape
  Pond "1" o-- "many" Duck : holds
  Duck ..> Food
  Duck -- Zoo`;

describe("parseClass", () => {
  it("reads classes, members, annotations and relationship kinds", () => {
    const g = graph(parseClass(ANIMALS));
    expect(g.nodes.map((n) => n.id)).toEqual(["Animal", "Duck", "Fish", "Shape", "Pond", "Food", "Zoo"]);
    expect(g.nodes.find((n) => n.id === "Animal")?.body).toEqual({ type: "text", markdown: "- `+int age`\n- `+String gender`\n- `+isMammal() bool`" });
    expect(g.nodes.find((n) => n.id === "Shape")?.body).toEqual({ type: "text", markdown: "«interface»" });
    expect(g.nodes.find((n) => n.id === "Food")?.body).toBeUndefined();
    const edges = g.edges.map((e) => `${e.from}>${e.to}:${e.relation}:${e.label ?? ""}`);
    expect(edges).toEqual([
      "Duck>Animal:implements:extends",
      "Fish>Animal:implements:extends",
      "Duck>Shape:implements:implements",
      "Pond>Duck:relates_to:holds (1 to many)",
      "Duck>Food:depends_on:uses",
      "Duck>Zoo:relates_to:",
    ]);
  });

  it("points inheritance and composition the right way whichever side the head is written on", () => {
    const g = graph(parseClass("classDiagram\nDuck --|> Animal\nPart --* Car\nCar *-- Wheel"));
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.label}`)).toEqual(["Duck>Animal:extends", "Car>Part:composed of", "Car>Wheel:composed of"]);
  });

  it("shows generics as <T>, keeps explicit labels, and makes namespaces sections", () => {
    const g = graph(parseClass('classDiagram\nnamespace Shapes {\n  class Square~Shape~ {\n    +List~int~ sides\n  }\n  class Tri["Triangle"]\n}\nSquare <|-- Cube'));
    expect(g.nodes.find((n) => n.id === "Square")).toMatchObject({ label: "Square<Shape>", subgraph: "Shapes", body: { markdown: "- `+List<int> sides`" } });
    expect(g.nodes.find((n) => n.id === "Tri")).toMatchObject({ label: "Triangle", subgraph: "Shapes" });
    expect(g.subgraphs.map((s) => s.id)).toEqual(["Shapes"]);
  });

  it("reports what it skips", () => {
    const g = graph(parseClass('classDiagram\nnote "hello"\nnote for A "x"\nclass A:::hot\nstyle A fill:#f9f\nclick A href "x"\nA --() B'));
    expect(g.notes).toEqual([
      "2 notes skipped — notes aren't converted",
      "1 styling line ignored — the canvas uses its own styling",
      "1 click/link line ignored",
      "1 lollipop interface link drawn as plain links",
    ]);
  });

  it("fails with a line for malformed input", () => {
    expect(parseClass("classDiagram\nclass A {\n  +x")).toMatchObject({ ok: false, error: { code: "syntax", kind: "class", line: 2 } });
    expect(parseClass("classDiagram\nA ~~ B ~~ C")).toMatchObject({ ok: false, error: { line: 2 } });
    expect(parseClass("classDiagram\n<<interface>>")).toMatchObject({ ok: false });
  });
});

const SHOP = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
  CUSTOMER {
    string name
    string custNumber PK
    string sector "retail or trade"
  }
  ORDER {
    int orderNumber PK
    string deliveryAddress FK, UK
  }
  p[Person] {
    string firstName
  }
  "LINE-ITEM" { }`;

describe("parseEr", () => {
  it("reads entities, attributes and cardinalities", () => {
    const g = graph(parseEr(SHOP));
    expect(g.nodes.map((n) => n.id)).toEqual(["CUSTOMER", "ORDER", "LINE-ITEM", "DELIVERY-ADDRESS", "p"]);
    expect(g.nodes.find((n) => n.id === "CUSTOMER")?.body).toEqual({
      type: "table",
      columns: ["Type", "Name", "Key", "Comment"],
      rows: [
        ["string", "name", "", ""],
        ["string", "custNumber", "PK", ""],
        ["string", "sector", "", "retail or trade"],
      ],
    });
    expect(g.nodes.find((n) => n.id === "ORDER")?.body).toMatchObject({
      columns: ["Type", "Name", "Key"],
      rows: [
        ["int", "orderNumber", "PK"],
        ["string", "deliveryAddress", "FK, UK"],
      ],
    });
    expect(g.nodes.find((n) => n.id === "p")).toMatchObject({ label: "Person", body: { columns: ["Type", "Name"] } });
    expect(g.nodes.find((n) => n.id === "LINE-ITEM")?.body).toBeUndefined();
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.label}:${e.line}`)).toEqual([
      "CUSTOMER>ORDER:places (1 to 0..*):solid",
      "ORDER>LINE-ITEM:contains (1 to 1..*):solid",
      "CUSTOMER>DELIVERY-ADDRESS:uses (1..* to 1..*):dotted",
    ]);
  });

  it("reads the word form", () => {
    const g = graph(parseEr("erDiagram\nCAR 1 to zero or more NAMED-DRIVER : allows\nPERSON only one optionally to one or more CAR : owns"));
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.label}:${e.line}`)).toEqual(["CAR>NAMED-DRIVER:allows (1 to 0..*):solid", "PERSON>CAR:owns (1 to 1..*):dotted"]);
  });

  it("fails with a line for malformed input", () => {
    expect(parseEr("erDiagram\nA {\n  string")).toMatchObject({ ok: false, error: { code: "syntax", kind: "er", line: 3 } });
    expect(parseEr("erDiagram\nA {\n  string x")).toMatchObject({ ok: false, error: { line: 2 } });
    expect(parseEr("erDiagram\nA <> B")).toMatchObject({ ok: false, error: { line: 2 } });
  });
});

describe("convertMermaid: class and ER diagrams", () => {
  it("a class diagram becomes an architecture plan of cards and typed links", () => {
    const { plan, kind } = convert(ANIMALS);
    expect(kind).toBe("class");
    expect(plan.template).toBe("architecture");
    expect(node(plan, "Duck")).toMatchObject({ type: "text", title: "Duck", role: "component", stableKey: "mermaid:class:node:Duck" });
    expect(node(plan, "Food")).toMatchObject({ type: "shape", content: { shape: "rectangle", label: "Food" } });
    expect(rels(plan)).toContain("Duck>Animal:implements:extends");
    expect(rels(plan)).toContain("Duck>Food:depends_on:uses");
    expect(plan.metadata?.summary).toMatch(/^Converted from a Mermaid class diagram: 7 nodes, 6 links\./);
    expect(validateVisualPlan(plan).plan).toEqual(plan);
  });

  it("an ER diagram's entities with attributes become table cards", () => {
    const { plan } = convert(SHOP);
    expect(plan.template).toBe("architecture");
    expect(node(plan, "CUSTOMER")).toMatchObject({ type: "table", title: "CUSTOMER" });
    expect(rels(plan)).toContain("CUSTOMER>ORDER:relates_to:places (1 to 0..*)");
    expect(validateVisualPlan(plan).plan).toEqual(plan);
  });

  it("namespaces become sections", () => {
    const { plan } = convert("classDiagram\nnamespace Core {\n  class A\n  class B\n}\nA <|-- B\nB --> C");
    expect(plan.template).toBe("sectioned");
    expect(node(plan, "Core")).toMatchObject({ type: "group", content: { label: "Core", arrangement: "grid" } });
    expect(node(plan, "A")).toMatchObject({ parent: "Core" });
    expect(node(plan, "C")).not.toHaveProperty("parent");
  });

  for (const [name, source] of [
    ["class", ANIMALS],
    ["er", SHOP],
    ["class with namespaces", "classDiagram\nnamespace Core {\n  class A {\n    +x\n  }\n  class B\n}\nA <|-- B\nB --> C"],
  ] as const) {
    it(`renders a ${name} diagram into a parseable change set, one object per node and one connect per link`, async () => {
      const { plan } = convert(source);
      const set = await renderVisualPlan(plan, renderOptions);
      expect(() => parseChangeSet(set)).not.toThrow();
      const groups = plan.nodes.filter((n) => n.type === "group").length;
      expect(set.changes.filter((c) => c.kind !== "connect" && c.kind !== "move")).toHaveLength(plan.nodes.length + groups);
      expect(set.changes.filter((c) => c.kind === "connect")).toHaveLength(plan.relationships.length);
    });
  }
});
