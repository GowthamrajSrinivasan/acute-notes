"use client";

/**
 * The OpenUI component library for Acute's note cards (`.ai/docs/open-intelligent-ui-audit.md` Option A, extended by
 * `.ai/docs/openui-integration-plan.md` Phases 2–3): primitives a model — or the deterministic Notes view builder
 * (`notesModel.ts`) — arranges into one distilled idea card, mirroring the vocabulary Visualize already uses
 * (`VisualNode`, knowledge-notes `sourceUnits`/`CardReview`) without reading or writing any of that code.
 *
 * Interactive behaviour (expanding a citation's passage, "More", Pin) is component-local React state plus what the
 * host offers through `useNotesHost()` — never a model call. Outside a host every component renders statically.
 *
 * Example OpenUI Lang this library accepts (positional args, in each component's Zod key order):
 *
 * ```
 * root = IdeaCard("Idempotency keys prevent duplicate charges", "When a client retries a payment request after a
 * timeout, the server matches the request's idempotency key and returns the original result instead of charging
 * twice.", "high", [c1, c2])
 * c1 = CitationChip("u4")
 * c2 = CitationChip("u7", "u7")
 * ```
 *
 * Props are positional, so a new prop is only ever appended (`detail`, `extras` came after Phase 1's four); reordering
 * would silently change what stored or generated Lang means.
 */
import { createLibrary, defineComponent, type PromptOptions } from "@openuidev/react-lang";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { z } from "zod/v4";
import { useNotesHost } from "./hostContext";
import { interactionComponents, NoteLink } from "./interactions";

/** Which citation of the enclosing IdeaCard has its passage open (one at a time, shown under the chips). */
interface OpenCitation {
  open: string | null;
  toggle(unit: string): void;
}
const OpenCitationContext = createContext<OpenCitation | null>(null);

function CitationChipView({ unit, label }: { unit: string; label?: string }) {
  const host = useNotesHost();
  const card = useContext(OpenCitationContext);
  const text = host.unitText?.(unit);
  // Static chip when there's nothing to expand (no host, unknown unit, or outside an IdeaCard).
  if (!text || !card) {
    return (
      <span className="openui-citation-chip" data-unit={unit} title={`Source unit ${unit}`}>
        {label ?? unit}
      </span>
    );
  }
  const open = card.open === unit;
  return (
    <button
      type="button"
      className="openui-citation-chip"
      data-unit={unit}
      data-open={open || undefined}
      aria-expanded={open}
      title={open ? "Hide source passage" : "Show source passage"}
      onClick={() => card.toggle(unit)}
    >
      {label ?? unit}
    </button>
  );
}

const CitationChip = defineComponent({
  name: "CitationChip",
  description:
    "An inline marker citing one source unit this card represents. Use one per unit cited, never one chip for several units.",
  props: z.object({
    unit: z.string().describe('The source unit id, e.g. "u17". Never a heading or a made-up id.'),
    label: z.string().optional().describe("Short label on the chip; defaults to the unit id."),
  }),
  component: ({ props }) => <CitationChipView unit={props.unit} label={props.label} />,
});

function SourceLinkView({ unit, label }: { unit: string; label?: string }) {
  const host = useNotesHost();
  return (
    <button type="button" className="openui-source-link" data-unit={unit} onClick={host.openSource ? () => host.openSource!([unit]) : undefined}>
      <span aria-hidden="true">↗</span> {label ?? "View source"}
    </button>
  );
}

const SourceLink = defineComponent({
  name: "SourceLink",
  description: "A prominent 'view in source' affordance for one unit, distinct from an inline CitationChip.",
  props: z.object({
    unit: z.string().describe("The source unit id this points at."),
    label: z.string().optional().describe('Link text; defaults to "View source".'),
  }),
  component: ({ props }) => <SourceLinkView unit={props.unit} label={props.label} />,
});

const Callout = defineComponent({
  name: "Callout",
  description:
    "A short aside flagging something about the idea itself (a caveat, an open question, why it needs review) — not a citation and not the idea's main body.",
  props: z.object({
    tone: z.enum(["info", "warning", "success"]).describe("info: context. warning: caveat/needs review. success: confirmed/resolved."),
    text: z.string(),
  }),
  component: ({ props }) => (
    <p className="openui-callout" data-tone={props.tone}>
      {props.text}
    </p>
  ),
});

const ComparisonTable = defineComponent({
  name: "ComparisonTable",
  description: "A small table for comparing a few options or facts side by side. Keep it to a handful of rows; prose fits better in the card body otherwise.",
  props: z.object({
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())),
  }),
  component: ({ props }) => (
    <table className="openui-comparison-table">
      <thead>
        <tr>
          {props.columns.map((col, i) => (
            <th key={i}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td key={c}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
});

interface IdeaCardViewProps {
  title: string;
  body: string;
  importance?: "low" | "medium" | "high";
  detail?: string;
  citations: ReactNode;
  citedUnits: string[];
  extras: ReactNode;
}

function IdeaCardView({ title, body, importance, detail, citations, citedUnits, extras }: IdeaCardViewProps) {
  const host = useNotesHost();
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const passage = openUnit ? host.unitText?.(openUnit) : undefined;
  return (
    <article className="openui-idea-card" data-importance={importance ?? "medium"} data-note-id={host.noteId}>
      <h3 className="openui-idea-card__title">{title}</h3>
      {body && <p className="openui-idea-card__body">{body}</p>}
      {detail && (
        <>
          {expanded && (
            <p className="openui-idea-card__detail" id={detailId}>
              {detail}
            </p>
          )}
          <button type="button" className="openui-idea-card__more" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Less" : "More"}
          </button>
        </>
      )}
      {extras && <div className="openui-idea-card__extras">{extras}</div>}
      {citedUnits.length > 0 && (
        <OpenCitationContext.Provider value={{ open: openUnit, toggle: (u) => setOpenUnit((cur) => (cur === u ? null : u)) }}>
          <div className="openui-idea-card__citations">{citations}</div>
        </OpenCitationContext.Provider>
      )}
      {passage && (
        <blockquote className="openui-idea-card__passage" data-unit={openUnit ?? undefined}>
          {passage}
        </blockquote>
      )}
      {(host.pin || (host.openSource && citedUnits.length > 0)) && (
        <div className="openui-idea-card__actions">
          {host.openSource && citedUnits.length > 0 && (
            <button type="button" className="openui-idea-card__action" onClick={() => host.openSource!(citedUnits)}>
              Open in source
            </button>
          )}
          {host.pin && (
            <button type="button" className="openui-idea-card__action" data-primary disabled={host.pin.done} onClick={() => host.pin!.run()}>
              {host.pin.label}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

const IdeaCard = defineComponent({
  name: "IdeaCard",
  description:
    "The root of one distilled idea card: a title, the idea in the model's own words, how important it is, and the source units it represents. Optional `detail` is a longer explanation shown only when the reader asks for more; optional `extras` holds at most a couple of Callout/ComparisonTable/SourceLink/NoteLink children when truly needed — most cards are just title + body + citations.",
  props: z.object({
    title: z.string(),
    body: z.string().describe("The distilled idea, in the model's own words — not a copy of the source sentence. One or two sentences."),
    importance: z.enum(["low", "medium", "high"]).optional(),
    citations: z.array(CitationChip.ref).optional().describe("One CitationChip per source unit this card represents."),
    detail: z.string().optional().describe("Further explanation, hidden behind 'More' until the reader expands it."),
    extras: z.array(z.union([Callout.ref, ComparisonTable.ref, SourceLink.ref, NoteLink.ref])).optional().describe("Optional asides under the body, including NoteLinks to related cards."),
  }),
  component: ({ props, renderNode }) => {
    const citations = props.citations ?? [];
    const citedUnits = citations.map((c) => (c as unknown as { props?: { unit?: unknown } }).props?.unit).filter((u): u is string => typeof u === "string");
    return (
      <IdeaCardView
        title={props.title}
        body={props.body}
        importance={props.importance}
        detail={props.detail}
        citations={citations.length ? renderNode(citations) : null}
        citedUnits={citedUnits}
        extras={props.extras && props.extras.length ? renderNode(props.extras) : null}
      />
    );
  },
});

/** The library: `IdeaCard` is the default root; any component may be a root (a Callout or table on its own, a Phase 3 card). */
export const acuteCardLibrary = createLibrary({
  id: "acute-notes-cards-v1",
  root: "IdeaCard",
  components: [CitationChip, SourceLink, Callout, ComparisonTable, IdeaCard, ...interactionComponents],
});

/** Generates the system prompt a model is given to emit this library's OpenUI Lang (`notesTask.ts`). */
export function acuteCardSystemPrompt(promptOptions?: PromptOptions): string {
  return acuteCardLibrary.prompt({
    preamble:
      "You distil a source document into idea cards. Each IdeaCard holds one idea in your own words, never a copy of the source sentence, and cites the source units (CitationChip) it represents.",
    additionalRules: [
      "Never cite a unit id you were not given.",
      "Prefer one IdeaCard per idea; do not merge unrelated ideas into one card.",
    ],
    ...promptOptions,
  });
}
