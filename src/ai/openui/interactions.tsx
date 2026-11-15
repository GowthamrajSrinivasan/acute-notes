"use client";

/**
 * Phase 3 knowledge-interaction components (`.ai/docs/openui-integration-plan.md` §1 Phase 3): decision, timeline,
 * flow-diagram, quiz, flashcard and cross-note-link cards. Every interaction is component-local React state, a bound
 * OpenUI `$variable` (QuizCard's `selected`), or a capability the host offers through `useNotesHost()` — never a model
 * call (Phase 3 acceptance: "meaningful interaction without additional model calls for basic UI actions"). With no host,
 * each renders statically and stays usable.
 *
 * Props are positional (the order of each Zod object's keys), so new props are only ever appended. `library.tsx`
 * registers `interactionComponents`; styles live in `components/openui/interactions.css`.
 *
 * This module cannot import `library.tsx` (it imports us), so citations here are plain unit ids rendered as chips.
 */
import { defineComponent, reactive, useStateField, type DefinedComponent, type ElementNode } from "@openuidev/react-lang";
import { useId, useRef, useState } from "react";
import { z } from "zod/v4";
import { useNotesHost } from "./hostContext";

/** A child node's props as the parser left them (possibly partial while streaming). */
function propsOf(node: unknown): Record<string, unknown> {
  const p = (node as ElementNode | null | undefined)?.props;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Unit chips that expand to the cited passage when the host can supply it. */
function UnitChips({ units }: { units: readonly string[] }) {
  const host = useNotesHost();
  const [open, setOpen] = useState<string | null>(null);
  if (!units.length) return null;
  const passage = open ? host.unitText?.(open) : undefined;
  return (
    <>
      <div className="openui-idea-card__citations">
        {units.map((u) =>
          host.unitText?.(u) ? (
            <button key={u} type="button" className="openui-citation-chip" data-unit={u} aria-expanded={open === u} onClick={() => setOpen((c) => (c === u ? null : u))}>
              {u}
            </button>
          ) : (
            <span key={u} className="openui-citation-chip" data-unit={u}>
              {u}
            </span>
          ),
        )}
      </div>
      {passage && <blockquote className="openui-idea-card__passage">{passage}</blockquote>}
    </>
  );
}

// ── DecisionCard ────────────────────────────────────────────────────────────

const DecisionOption = defineComponent({
  name: "DecisionOption",
  description: "One option a DecisionCard weighs: its name and short pros/cons. Only used inside DecisionCard.options.",
  props: z.object({
    name: z.string(),
    pros: z.array(z.string()).optional(),
    cons: z.array(z.string()).optional(),
  }),
  component: ({ props }) => <OptionBody name={props.name} pros={props.pros ?? []} cons={props.cons ?? []} />,
});

function OptionBody({ name, pros, cons }: { name: string; pros: string[]; cons: string[] }) {
  return (
    <div className="openui-decision__option-body">
      <span className="openui-decision__option-name">{name}</span>
      {pros.length > 0 && (
        <ul className="openui-decision__pros" aria-label="Pros">
          {pros.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {cons.length > 0 && (
        <ul className="openui-decision__cons" aria-label="Cons">
          {cons.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DecisionCardView({ question, options, chosen, rationale, citations }: { question: string; options: unknown[]; chosen?: string; rationale?: string; citations: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <article className="openui-decision" data-note-id={useNotesHost().noteId}>
      <h3 className="openui-decision__question">{question}</h3>
      <div className="openui-decision__options" role="group" aria-label="Options">
        {options.map((node, i) => {
          const p = propsOf(node);
          const name = str(p.name) ?? "";
          return (
            <button
              key={`${i}-${name}`}
              type="button"
              className="openui-decision__option"
              aria-pressed={selected === name}
              data-chosen={chosen === name || undefined}
              onClick={() => setSelected((s) => (s === name ? null : name))}
            >
              {chosen === name && <span className="openui-decision__badge">Decision</span>}
              <OptionBody name={name} pros={strs(p.pros)} cons={strs(p.cons)} />
            </button>
          );
        })}
      </div>
      {rationale && (
        <p className="openui-decision__rationale">
          <strong>Why:</strong> {rationale}
        </p>
      )}
      <UnitChips units={citations} />
    </article>
  );
}

const DecisionCard = defineComponent({
  name: "DecisionCard",
  description:
    "A decision and the options weighed for it. `options` are DecisionOption children; `chosen` is the exact name of the option decided on (omit if undecided); `rationale` says why; `citations` are source unit ids.",
  props: z.object({
    question: z.string(),
    options: z.array(DecisionOption.ref),
    chosen: z.string().optional(),
    rationale: z.string().optional(),
    citations: z.array(z.string()).optional().describe("Source unit ids, e.g. [\"u4\"]."),
  }),
  component: ({ props }) => (
    <DecisionCardView question={props.question} options={(props.options ?? []) as unknown[]} chosen={props.chosen} rationale={props.rationale} citations={props.citations ?? []} />
  ),
});

// ── Timeline ────────────────────────────────────────────────────────────────

const TimelineEvent = defineComponent({
  name: "TimelineEvent",
  description: "One dated event in a Timeline: when, a short label, optional detail, optional source unit id. Only used inside Timeline.events.",
  props: z.object({
    when: z.string(),
    label: z.string(),
    detail: z.string().optional(),
    unit: z.string().optional(),
  }),
  component: ({ props }) => (
    <span className="openui-timeline__static">
      <span className="openui-timeline__when">{props.when}</span> {props.label}
    </span>
  ),
});

function TimelineView({ title, events }: { title: string; events: unknown[] }) {
  const host = useNotesHost();
  const [open, setOpen] = useState<number | null>(null);
  const baseId = useId();
  return (
    <article className="openui-timeline">
      <h3 className="openui-timeline__title">{title}</h3>
      <ol className="openui-timeline__list">
        {events.map((node, i) => {
          const p = propsOf(node);
          const detail = str(p.detail);
          const unit = str(p.unit);
          const passage = unit ? host.unitText?.(unit) : undefined;
          const expandable = !!(detail || passage);
          const isOpen = open === i;
          return (
            <li key={i} className="openui-timeline__event" data-open={isOpen || undefined}>
              <button
                type="button"
                className="openui-timeline__head"
                aria-expanded={expandable ? isOpen : undefined}
                aria-controls={expandable ? `${baseId}-${i}` : undefined}
                disabled={!expandable}
                onClick={() => setOpen((o) => (o === i ? null : i))}
              >
                <span className="openui-timeline__when">{str(p.when) ?? ""}</span>
                <span className="openui-timeline__label">{str(p.label) ?? ""}</span>
              </button>
              {isOpen && (
                <div className="openui-timeline__detail" id={`${baseId}-${i}`}>
                  {detail && <p>{detail}</p>}
                  {passage && (
                    <blockquote className="openui-idea-card__passage" data-unit={unit}>
                      {passage}
                    </blockquote>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

const Timeline = defineComponent({
  name: "Timeline",
  description: "Events in time order (TimelineEvent children). Use for history, rollouts, incident sequences — not for unordered facts.",
  props: z.object({
    title: z.string(),
    events: z.array(TimelineEvent.ref),
  }),
  component: ({ props }) => <TimelineView title={props.title} events={(props.events ?? []) as unknown[]} />,
});

// ── FlowDiagram ─────────────────────────────────────────────────────────────

function FlowDiagramView({ title, steps, details }: { title: string; steps: string[]; details: string[] }) {
  const [active, setActive] = useState<number | null>(null);
  const detailId = useId();
  const detail = active !== null ? details[active] : undefined;
  return (
    <article className="openui-flow">
      <h3 className="openui-flow__title">{title}</h3>
      <ol className="openui-flow__steps">
        {steps.map((s, i) => (
          <li key={i} className="openui-flow__step">
            <button
              type="button"
              className="openui-flow__node"
              aria-pressed={active === i}
              aria-controls={details[i] ? detailId : undefined}
              disabled={!details[i]}
              onClick={() => setActive((a) => (a === i ? null : i))}
            >
              <span className="openui-flow__index">{i + 1}</span> {s}
            </button>
            {i < steps.length - 1 && (
              <span className="openui-flow__arrow" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
      {detail && (
        <p className="openui-flow__detail" id={detailId} aria-live="polite">
          <strong>
            {active! + 1}. {steps[active!]}:
          </strong>{" "}
          {detail}
        </p>
      )}
    </article>
  );
}

const FlowDiagram = defineComponent({
  name: "FlowDiagram",
  description: "A short process as connected steps, left to right. `details[i]` explains step i and shows when the reader selects it. Keep to 2–7 steps.",
  props: z.object({
    title: z.string(),
    steps: z.array(z.string()).min(1),
    details: z.array(z.string()).optional(),
  }),
  component: ({ props }) => <FlowDiagramView title={props.title} steps={props.steps ?? []} details={props.details ?? []} />,
});

// ── QuizCard ────────────────────────────────────────────────────────────────

function QuizCardView({ question, choices, answer, explanation, unit, binding }: { question: string; choices: string[]; answer: number; explanation?: string; unit?: string; binding: unknown }) {
  const host = useNotesHost();
  // Bound to a `$variable` when the Lang passes one (then the pick lives in the Renderer's store and other bound
  // components see it); otherwise plain local state.
  const field = useStateField<number | null>("selected", binding as number | null | undefined);
  const [local, setLocal] = useState<number | null>(null);
  const picked = field.isReactive ? (typeof field.value === "number" ? field.value : null) : local;
  const set = (i: number | null) => (field.isReactive ? field.setValue(i) : setLocal(i));
  // Study history: only the first pick of this mount counts; "Try again" picks are practice, never recorded.
  const recorded = useRef(false);
  const pick = (i: number) => {
    if (!recorded.current && host.recordStudy) {
      recorded.current = true;
      host.recordStudy({ kind: "quiz", correct: i === answer });
    }
    set(i);
  };
  const answered = picked !== null;
  const correct = answered && picked === answer;
  const passage = unit ? host.unitText?.(unit) : undefined;
  return (
    <article className="openui-quiz" data-state={!answered ? "open" : correct ? "correct" : "incorrect"}>
      <h3 className="openui-quiz__question">{question}</h3>
      <div className="openui-quiz__choices" role="group" aria-label="Choices">
        {choices.map((c, i) => (
          <button
            key={i}
            type="button"
            className="openui-quiz__choice"
            aria-pressed={picked === i}
            data-result={answered && i === answer ? "answer" : answered && i === picked ? "wrong" : undefined}
            disabled={answered}
            onClick={() => pick(i)}
          >
            {c}
          </button>
        ))}
      </div>
      {answered && (
        <div className="openui-quiz__feedback" role="status">
          <p className="openui-quiz__verdict">{correct ? "Correct." : `Not quite — the answer is “${choices[answer] ?? ""}”.`}</p>
          {explanation && <p className="openui-quiz__explanation">{explanation}</p>}
          {passage && <blockquote className="openui-idea-card__passage">{passage}</blockquote>}
          <button type="button" className="openui-quiz__retry" onClick={() => set(null)}>
            Try again
          </button>
        </div>
      )}
    </article>
  );
}

const QuizCard = defineComponent({
  name: "QuizCard",
  description:
    "A multiple-choice check on one idea. `answer` is the 0-based index of the correct choice; `explanation` is shown after answering; `unit` is the source unit it tests. `selected` may be bound to a $variable to share the pick.",
  props: z.object({
    question: z.string(),
    choices: z.array(z.string()).min(2),
    answer: z.number().int().min(0),
    explanation: z.string().optional(),
    unit: z.string().optional(),
    selected: reactive(z.number().int().nullable().optional()),
  }),
  component: ({ props }) => (
    <QuizCardView question={props.question} choices={props.choices ?? []} answer={props.answer} explanation={props.explanation} unit={props.unit} binding={props.selected} />
  ),
});

// ── Flashcard ───────────────────────────────────────────────────────────────

function FlashcardView({ front, back, unit }: { front: string; back: string; unit?: string }) {
  const host = useNotesHost();
  const [flipped, setFlipped] = useState(false);
  // Issue B: a flip alone records nothing; after each reveal the reader may grade it once ("Got it" / "Missed it").
  const [graded, setGraded] = useState<boolean | null>(null);
  const flip = () => {
    setFlipped((f) => !f);
    setGraded(null);
  };
  const grade = (correct: boolean) => {
    if (graded !== null || !host.recordStudy) return;
    setGraded(correct);
    host.recordStudy({ kind: "flashcard", correct });
  };
  return (
    <article className="openui-flashcard" data-flipped={flipped || undefined}>
      <button type="button" className="openui-flashcard__face" aria-pressed={flipped} aria-label={flipped ? "Show front" : "Show answer"} onClick={flip}>
        <span className="openui-flashcard__side">{flipped ? "Answer" : "Prompt"}</span>
        <span className="openui-flashcard__text">{flipped ? back : front}</span>
      </button>
      {flipped && unit && <UnitChips units={[unit]} />}
      {flipped && host.recordStudy && (
        <div className="openui-flashcard__grade" role="group" aria-label="Did you recall it?">
          {graded === null ? (
            <>
              <button type="button" className="openui-quiz__retry openui-flashcard__got" onClick={() => grade(true)}>
                Got it
              </button>
              <button type="button" className="openui-quiz__retry openui-flashcard__missed" onClick={() => grade(false)}>
                Missed it
              </button>
            </>
          ) : (
            <span className="openui-flashcard__graded" role="status">
              {graded ? "Recorded: got it" : "Recorded: missed it"}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

const Flashcard = defineComponent({
  name: "Flashcard",
  description: "A study card: `front` is a prompt (usually the idea's title), `back` the idea itself; the reader flips it. `unit` is the source unit.",
  props: z.object({
    front: z.string(),
    back: z.string(),
    unit: z.string().optional(),
  }),
  component: ({ props }) => <FlashcardView front={props.front} back={props.back} unit={props.unit} />,
});

// ── NoteLink ────────────────────────────────────────────────────────────────

function NoteLinkView({ target, label }: { target: string; label?: string }) {
  const host = useNotesHost();
  const text = label ?? host.noteTitle?.(target) ?? target;
  if (!host.navigate) {
    return (
      <span className="openui-note-link" data-target={target}>
        {text}
      </span>
    );
  }
  return (
    <button type="button" className="openui-note-link" data-target={target} onClick={() => host.navigate!(target)}>
      <span aria-hidden="true">→</span> {text}
    </button>
  );
}

export const NoteLink = defineComponent({
  name: "NoteLink",
  description: "A link to another note in the same notes view, by its note id. Use for 'see also' between related ideas; never invent an id.",
  props: z.object({
    target: z.string().describe("The other note's id."),
    label: z.string().optional(),
  }),
  component: ({ props }) => <NoteLinkView target={props.target} label={props.label} />,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const interactionComponents: DefinedComponent<any>[] = [DecisionOption, DecisionCard, TimelineEvent, Timeline, FlowDiagram, QuizCard, Flashcard, NoteLink];
