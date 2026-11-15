"use client";

/**
 * The Weak list of the Notes view's Study mode (`.ai/docs/study-mode-implementation-plan.md` §5, §7): the concepts the
 * reader keeps missing, from the device-local study history (`ai/study/store.ts`), ranked by `rankWeak`. Deterministic
 * from the stored attempts and `now`: no model call and no canvas write.
 *
 * - Each row: the title (the live card's, else the one stored), the band, mastery, fresh attempts, the last attempt, the
 *   state badge ("Source changed since you studied this", "Needs review"), the card's open review, and `related`
 *   context (display only: another concept's attempts never count here).
 * - Links back: the cited passages (chips that expand to the passage text), "Open in source" when a live card cites
 *   the concept, "Show citing cards" (works with no card teaching it now), and "Quiz me on these".
 * - Concepts from cards that need review sit in their own group; local concepts show without passages; retired
 *   concepts are hidden behind "Show retired (n)".
 */
import { useMemo, useState } from "react";
import { isLocalConcept } from "@/ai/study/concept";
import { bandOf, freshAttempts, masteryOf, rankWeak, type StudyRecord, type WeakItem } from "@/ai/study/mastery";
import type { LoadedConcept, StudyConceptRecord } from "@/ai/study/store";

/** A live card on the canvas, as Study sees it. */
export interface StudyCardRef {
  id: string;
  title: string;
  conceptKey: string;
  /** The card has an open review. */
  needsReview?: string;
  /** The card cites passages of a source (so "Open in source" can show them). */
  cites: readonly string[];
}

export interface WeakConceptsProps {
  study: ReadonlyMap<string, LoadedConcept>;
  cards: readonly StudyCardRef[];
  now: number;
  /** A cited passage's text, when its source version is loaded. */
  unitText(sourceId: string, version: number, unit: string): string | undefined;
  openSource(cardId: string, units: readonly string[]): void;
  showCiting(sourceId: string, units: readonly string[]): void;
  quizOn(cardIds: readonly string[]): void;
  /** "Clear study history" (plan §2): the host confirms, then deletes this workspace's history. Absent: no button. */
  clearHistory?(): void;
}

const NO_FLAGS_LINE = "Checked against the source by rules, not by AI: a card that passes isn't proven correct.";

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const asRecord = (r: StudyConceptRecord): StudyRecord => r;
const BAND_LABEL = { new: "New", weak: "Weak", learning: "Learning", strong: "Strong" } as const;

export function WeakConcepts({ study, cards, now, unitText, openSource, showCiting, quizOn, clearHistory }: WeakConceptsProps) {
  const [showRetired, setShowRetired] = useState(false);
  const cardsOf = useMemo(() => {
    const m = new Map<string, StudyCardRef[]>();
    for (const c of cards) m.set(c.conceptKey, [...(m.get(c.conceptKey) ?? []), c]);
    return m;
  }, [cards]);
  const underReview = (key: string, r: StudyConceptRecord) => {
    const live = cardsOf.get(key);
    return live?.length ? live.some((c) => !!c.needsReview) || r.state === "needs_review" : r.cardStatus?.status === "open" || r.state === "needs_review";
  };

  const ranked = useMemo(() => rankWeak(Object.fromEntries([...study].map(([k, c]) => [k, asRecord(c.record)])), now), [study, now]);
  const reviewGroup = ranked.filter((w) => underReview(w.key, study.get(w.key)!.record));
  const mainGroup = ranked.filter((w) => !reviewGroup.includes(w));
  const retired = [...study.values()].filter((c) => c.record.state === "retired");
  const quizIds = [...new Set(ranked.flatMap((w) => (cardsOf.get(w.key) ?? []).map((c) => c.id)))];

  const row = (w: WeakItem) => {
    const { record } = study.get(w.key)!;
    return <ConceptRow key={w.key} conceptKey={w.key} record={record} weak={w} study={study} live={cardsOf.get(w.key) ?? []} now={now} capped={underReview(w.key, record)} unitText={unitText} openSource={openSource} showCiting={showCiting} />;
  };

  return (
    <div className="acute-notes__weak" data-testid="acute-notes-weak">
      {ranked.length === 0 ? (
        <p className="acute-notes__hint">Nothing weak yet. Answer quiz cards or grade flashcards, and the concepts you miss show up here.</p>
      ) : (
        <p className="acute-notes__hint">
          {ranked.length} weak {ranked.length === 1 ? "concept" : "concepts"}
          {quizIds.length > 0 && (
            <>
              {" · "}
              <button type="button" className="openui-quiz__retry" onClick={() => quizOn(quizIds)}>
                Quiz me on these
              </button>
            </>
          )}
        </p>
      )}
      {mainGroup.map(row)}
      {reviewGroup.length > 0 && (
        <section className="acute-notes__weak-group" aria-label="From cards that need review">
          <h4 className="acute-notes__section-title">From cards that need review</h4>
          <p className="acute-notes__hint">{NO_FLAGS_LINE}</p>
          {reviewGroup.map(row)}
        </section>
      )}
      {retired.length > 0 && (
        <p className="acute-notes__hint">
          <button type="button" className="openui-quiz__retry" aria-expanded={showRetired} onClick={() => setShowRetired((s) => !s)}>
            {showRetired ? "Hide retired" : `Show retired (${retired.length})`}
          </button>
        </p>
      )}
      {showRetired &&
        retired.map((c) => (
          <div key={c.key} className="acute-notes__note acute-notes__weak-row" data-concept={c.key} data-retired="true">
            <strong>{c.record.title || "Untitled"}</strong> <span className="acute-notes__badge">Retired</span>
            <span className="acute-notes__hint">{c.record.reason === "source_missing" ? " The source isn't on this device." : " Its passages were removed from the source."}</span>
          </div>
        ))}
      {clearHistory && study.size > 0 && (
        <p className="acute-notes__hint">
          Study history stays on this device.{" "}
          <button type="button" className="openui-quiz__retry" data-testid="acute-notes-clear-study" onClick={clearHistory}>
            Clear study history
          </button>
        </p>
      )}
    </div>
  );
}

function ConceptRow({
  conceptKey,
  record,
  weak,
  study,
  live,
  now,
  capped,
  unitText,
  openSource,
  showCiting,
}: {
  conceptKey: string;
  record: StudyConceptRecord;
  weak: WeakItem;
  study: ReadonlyMap<string, LoadedConcept>;
  live: readonly StudyCardRef[];
  now: number;
  capped: boolean;
  unitText: WeakConceptsProps["unitText"];
  openSource: WeakConceptsProps["openSource"];
  showCiting: WeakConceptsProps["showCiting"];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const r = asRecord(record);
  const fresh = freshAttempts(r);
  const last = fresh[fresh.length - 1]!;
  const band = bandOf(r, now, capped);
  const { m } = masteryOf(r, now);
  const local = isLocalConcept(conceptKey);
  const sourceId = local ? undefined : study.get(conceptKey)?.shardId;
  const units = local ? [] : (record.units ?? []);
  const passage = open && sourceId && record.sourceVersion !== undefined ? unitText(sourceId, record.sourceVersion, open) : undefined;
  const reviewOpen = live.some((c) => !!c.needsReview) || (!live.length && record.cardStatus?.status === "open");
  const citing = live.find((c) => c.cites.length);
  return (
    <div className="acute-notes__note acute-notes__weak-row" data-concept={conceptKey} data-testid="acute-notes-weak-row">
      <div>
        <strong className="acute-notes__weak-title">{live[0]?.title || record.title || "Untitled"}</strong>{" "}
        <span className="acute-notes__badge" data-band={band}>
          {BAND_LABEL[band]}
        </span>
        {record.state === "source_changed" && <span className="acute-notes__badge">Source changed since you studied this</span>}
        {record.state === "needs_review" && <span className="acute-notes__badge">Needs review</span>}
        {reviewOpen && <span className="acute-notes__badge">Card needs review</span>}
      </div>
      <p className="acute-notes__hint">
        {`Mastery ${Math.round(m * 100)}% · ${fresh.length} ${fresh.length === 1 ? "attempt" : "attempts"} · last ${ago(now - last[0])}, ${last[2] ? "got it" : "missed"}`}
        {weak.because === "low_accuracy" ? " · often missed" : " · missed last time"}
        {!live.length && " · no card teaches this now"}
      </p>
      {(record.related ?? []).map((rel) => {
        const other = study.get(rel.key)?.record;
        if (!other) return null;
        const correct = other.attempts.reduce((n, a) => n + a[2], 0);
        const name = other.title || "another concept";
        const text =
          rel.rel === "split_from"
            ? `Studied before as part of ‘${name}’ (${correct}/${other.attempts.length})`
            : rel.rel === "merged_from"
              ? `Studied before as ‘${name}’ (${correct}/${other.attempts.length})`
              : `Overlaps ‘${name}’ (${correct}/${other.attempts.length})`;
        return (
          <p key={`${rel.rel}-${rel.key}`} className="acute-notes__hint" data-related={rel.rel}>
            {text}
          </p>
        );
      })}
      {units.length > 0 && (
        <div className="openui-idea-card__citations">
          {units.map((u) => (
            <button key={u} type="button" className="openui-citation-chip" data-unit={u} aria-expanded={open === u} onClick={() => setOpen((c) => (c === u ? null : u))}>
              {u}
            </button>
          ))}
        </div>
      )}
      {passage && <blockquote className="openui-idea-card__passage">{passage}</blockquote>}
      {!local && sourceId && (
        <div className="acute-notes__weak-actions">
          {citing && (
            <button type="button" className="openui-quiz__retry" onClick={() => openSource(citing.id, units)}>
              Open in source
            </button>
          )}{" "}
          <button type="button" className="openui-quiz__retry" onClick={() => showCiting(sourceId, units)}>
            Show citing cards
          </button>
        </div>
      )}
    </div>
  );
}
