"use client";

/**
 * The Source tab (knowledge-notes-plan §5.1, §5.2; WP2.1–2.3): the content source of the selected card, at the
 * version the card was made from, with one mark per outcome and the card's passages highlighted.
 *
 * Self-contained: the integrator mounts it in the side panel and supplies `state`, `selection` and the callbacks
 * (`SourcePanelProps` in `ai/fidelity/contracts.ts`). Actions whose callback is absent are not shown.
 *
 * - Loading / "Source not on this device" / ready.
 * - "Source updated since this card" with View latest and What changed (from `lineage`).
 * - Marks: Represented plain, Intentionally omitted grey, Needs review amber; the reason on hover (and for screen
 *   readers, in the text).
 * - The selection is highlighted and scrolled into view; "Passage 1 of 3 ‹ ›" steps through it. Clicking a passage
 *   calls `onSelectPassage`; the active passage gets Add to canvas / Pin quote / Include (Include only when omitted).
 * - Long sources: an outline with counts per outcome (click to jump), filters, sections folded to their heading
 *   unless something in them is selected or needs review, and windowed rendering (only rows near the viewport).
 *
 * The pure parts live in `segments.ts` (marks), `layout.ts` (rows and windowing) and `changes.ts` (What changed).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { SourceFilter, SourcePanelData, SourcePanelProps, UnitId, UnitOutcome } from "@/ai/fidelity/contracts";
import { prefersReducedMotion } from "@/components/canvas/motion";
import { CHANGE_LABEL, describeChanges, excerptOf, summarizeLineage } from "./changes";
import { buildRows, estimateHeight, isOpen, rowOffsets, rowOfSection, rowOfSegment, visibleRange, type Row } from "./layout";
import { buildSourceView, matchesFilter, totalCounts, type OutcomeCounts, type Passage, type Segment, type SectionView, type UnitSegment } from "./segments";
import "./sourcePanel.css";

export const OUTCOME_LABEL: Record<UnitOutcome, string> = {
  represented: "Represented",
  omitted: "Intentionally omitted",
  needs_review: "Needs review",
};

export const FILTERS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs review" },
  { id: "omitted", label: "Omitted" },
  { id: "not_on_canvas", label: "Not on canvas" },
];

/** Viewport height used before the panel has been laid out (and in tests, where nothing is). */
const FALLBACK_VIEWPORT = 600;

export function SourcePanel(props: SourcePanelProps) {
  const { state } = props;
  if (state.kind === "loading") {
    return (
      <section className="acute-source" aria-label="Source" aria-busy="true">
        <p className="acute-source__message" role="status">
          Loading source…
        </p>
      </section>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <section className="acute-source" aria-label="Source">
        <div className="acute-source__message" role="status">
          <strong>Source not on this device</strong>
          <p>The content this was made from isn&apos;t stored here, so its passages can&apos;t be shown. An export that includes its sources brings them back.</p>
        </div>
      </section>
    );
  }
  const { data } = state;
  return <ReadySourcePanel key={`${data.sourceId}@${data.version}`} {...props} data={data} />;
}

/** A value for a quoted attribute selector. */
const attr = (value: string) => value.replace(/["\\]/g, "\\$&");

function selectionKey(selection: SourcePanelProps["selection"]): string {
  return `${selection.units.join(",")}|${(selection.spans ?? []).map((s) => `${s.start}-${s.end}`).join(",")}`;
}

function countsText(c: OutcomeCounts): string {
  const parts = [`${c.represented} represented`];
  if (c.omitted) parts.push(`${c.omitted} omitted`);
  if (c.needs_review) parts.push(`${c.needs_review} need${c.needs_review === 1 ? "s" : ""} review`);
  return parts.join(" · ");
}

function ReadySourcePanel({ data, selection, onSelectPassage, onAddToCanvas, onPinQuote, onInclude, onViewLatest, reducedMotion }: SourcePanelProps & { data: SourcePanelData }) {
  const selKey = selectionKey(selection);
  // Rebuilt only when the data or the selection's contents change, not on every new selection object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => buildSourceView(data, selection), [data, selKey]);
  const totals = useMemo(() => totalCounts(view.sections), [view]);
  const notOnCanvas = useMemo(() => view.sections.reduce((n, s) => n + s.notOnCanvas, 0), [view]);
  const onCanvasSet = useMemo(() => (data.onCanvas ? new Set(data.onCanvas) : null), [data]);
  const passes = (unit: UnitId, f: SourceFilter) => matchesFilter(data.outcome[unit], f, onCanvasSet ? onCanvasSet.has(unit) : undefined);
  const changes = useMemo(() => (data.latestVersion > data.version ? summarizeLineage(data.lineage, view.unitById) : null), [data, view]);

  const [filter, setFilter] = useState<SourceFilter>("all");
  const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const [stepIndex, setStepIndex] = useState(0);
  const current: Passage | undefined = view.passages[Math.min(stepIndex, view.passages.length - 1)];
  const [active, setActive] = useState<UnitId | null>(null);
  const activeUnit = active ?? current?.units[0] ?? null;
  const [showChanges, setShowChanges] = useState(false);
  const reduced = reducedMotion ?? prefersReducedMotion();

  const rows = useMemo(() => buildRows(view.sections, data.text, { filter, toggled }), [view, data.text, filter, toggled]);

  // ---- windowing: rendered rows are measured by a ResizeObserver; the others use estimates.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const offsets = useMemo(() => rowOffsets(rows, (r) => heights.get(r.key) ?? estimateHeight(r)), [rows, heights]);

  /** Where to scroll to show `key` (a unit, a span passage or a section heading `h:N`) among `inRows`. */
  const scrollFor = useCallback(
    (key: string, section: number, inRows: readonly Row[], inOffsets: Float64Array): number | null => {
      const sec = view.sections[section];
      if (!sec) return null;
      let row: number;
      if (key.startsWith("h:")) row = rowOfSection(inRows, section);
      else {
        const segment = sec.segments.findIndex((s) => (s.kind === "unit" ? s.unit === key : s.passage === key));
        row = segment >= 0 ? rowOfSegment(inRows, section, segment) : rowOfSection(inRows, section);
      }
      return row < 0 ? null : Math.max(0, (inOffsets[row] ?? 0) - 24);
    },
    [view],
  );

  // A pending jump: the window moves to `top` at once; the layout effect then scrolls the element itself into view.
  const [jump, setJump] = useState<{ key: string; top: number; nonce: number } | null>(() => {
    const p = view.passages[0];
    const top = p ? scrollFor(p.key, p.section, rows, offsets) : null;
    return p && top !== null ? { key: p.key, top, nonce: 1 } : null;
  });
  const [scrollTop, setScrollTop] = useState(jump?.top ?? 0);

  /** Brings `key` into view, with the rows as they will be after this update (a filter change, an unfolded section). */
  const jumpTo = (key: string, section: number, next: { filter?: SourceFilter; toggled?: ReadonlyMap<number, boolean> } = {}) => {
    const changed = next.filter !== undefined || next.toggled !== undefined;
    const nextRows = changed ? buildRows(view.sections, data.text, { filter: next.filter ?? filter, toggled: next.toggled ?? toggled }) : rows;
    const nextOffsets = changed ? rowOffsets(nextRows, (r) => heights.get(r.key) ?? estimateHeight(r)) : offsets;
    const top = scrollFor(key, section, nextRows, nextOffsets);
    if (top === null) return;
    setScrollTop(top);
    setJump((j) => ({ key, top, nonce: (j?.nonce ?? 0) + 1 }));
  };

  // Another card selected: back to its first passage, scrolled into view (adjusted during render, not in an effect).
  const [seenSelection, setSeenSelection] = useState(selKey);
  if (seenSelection !== selKey) {
    setSeenSelection(selKey);
    setStepIndex(0);
    setActive(null);
    const p = view.passages[0];
    const top = p ? scrollFor(p.key, p.section, rows, offsets) : null;
    if (p && top !== null) {
      setScrollTop(top);
      setJump((j) => ({ key: p.key, top, nonce: (j?.nonce ?? 0) + 1 }));
    }
  }

  const [first, last] = visibleRange(offsets, scrollTop, viewport);
  const total = offsets[rows.length] ?? 0;

  const done = useRef(0);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !jump || done.current === jump.nonce) return;
    done.current = jump.nonce;
    body.scrollTop = jump.top;
    if (!jump.key) return;
    const heading = jump.key.startsWith("h:");
    const el = heading ? body.querySelector<HTMLElement>(`[data-row-key="${attr(jump.key)}"]`) : body.querySelector<HTMLElement>(`[data-passage="${attr(jump.key)}"], [data-unit="${attr(jump.key)}"]`);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: heading ? "start" : "center", behavior: reduced ? "auto" : "smooth" });
  }, [jump, reduced]);

  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      let viewportHeight = 0;
      const measured: [string, number][] = [];
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (el === body) viewportHeight = body.clientHeight;
        else if (el.dataset.rowKey && el.offsetHeight > 0) measured.push([el.dataset.rowKey, el.offsetHeight]);
      }
      if (viewportHeight > 0) setViewport(viewportHeight);
      if (!measured.length) return;
      setHeights((m) => {
        if (measured.every(([k, h]) => Math.abs((m.get(k) ?? -10) - h) <= 1)) return m;
        const next = new Map(m);
        for (const [k, h] of measured) next.set(k, h);
        return next;
      });
    });
    ro.observe(body);
    for (const el of body.querySelectorAll("[data-row-key]")) ro.observe(el);
    observer.current = ro;
    return () => {
      ro.disconnect();
      observer.current = null;
    };
  }, []);
  /** Row ref: a row is measured while it is rendered. */
  const measureRow = useCallback((el: HTMLElement | null) => {
    const ro = observer.current;
    if (!el || !ro) return;
    ro.observe(el);
    return () => ro.unobserve(el);
  }, []);

  // ---- interactions
  const choose = (unit: UnitId) => {
    setActive(unit);
    onSelectPassage?.([unit]);
  };
  const onBodyClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-unit]");
    if (el?.dataset.unit) choose(el.dataset.unit);
  };
  const onBodyKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-unit]");
    if (!el?.dataset.unit) return;
    e.preventDefault();
    choose(el.dataset.unit);
  };
  /** The fold state with `section` unfolded, or undefined when it already is. */
  const unfolded = (section: number): ReadonlyMap<number, boolean> | undefined => {
    const sec = view.sections[section];
    if (!sec?.heading || isOpen(sec, toggled)) return undefined;
    return new Map(toggled).set(section, true);
  };
  const reveal = (key: string, section: number, units: readonly UnitId[]) => {
    // Shown in the text: a filter the passage doesn't match is cleared, a folded section opened.
    const nextFilter = filter !== "all" && units.some((u) => !passes(u, filter)) ? "all" : undefined;
    if (nextFilter) setFilter(nextFilter);
    const nextToggled = unfolded(section);
    if (nextToggled) setToggled(nextToggled);
    jumpTo(key, section, { filter: nextFilter, toggled: nextToggled });
  };
  const stepBy = (delta: number) => {
    const n = view.passages.length;
    if (!n) return;
    const index = (Math.min(stepIndex, n - 1) + delta + n) % n;
    const p = view.passages[index]!;
    setStepIndex(index);
    setActive(null);
    reveal(p.key, p.section, p.units);
  };
  const jumpToUnit = (unit: UnitId) => {
    const section = view.sectionOfUnit.get(unit);
    if (section === undefined) return;
    setActive(unit);
    reveal(unit, section, [unit]);
  };
  const jumpToSection = (section: number) => {
    const nextToggled = unfolded(section);
    if (nextToggled) setToggled(nextToggled);
    jumpTo(`h:${section}`, section, { toggled: nextToggled });
  };
  const toggleSection = (section: SectionView, open: boolean) => {
    setToggled((m) => new Map(m).set(section.index, !open));
  };
  const chooseFilter = (f: SourceFilter) => {
    setFilter(f);
    setScrollTop(0);
    setJump((j) => ({ key: "", top: 0, nonce: (j?.nonce ?? 0) + 1 }));
  };

  const filterCount = (f: SourceFilter) => (f === "all" ? null : f === "needs_review" ? totals.needs_review : f === "omitted" ? totals.omitted : notOnCanvas);

  const actionsFor = (unit: UnitId) => {
    const omitted = data.outcome[unit] === "omitted";
    const buttons: ReactNode[] = [];
    if (onAddToCanvas) buttons.push(<button key="add" type="button" onClick={() => onAddToCanvas(unit)} title="Make a card from this passage (no AI)">Add to canvas</button>);
    if (onPinQuote) buttons.push(<button key="pin" type="button" onClick={() => onPinQuote(unit)} title="Put this passage, word for word, on the selected card">Pin quote</button>);
    if (omitted && onInclude) buttons.push(<button key="include" type="button" data-primary onClick={() => onInclude(unit)} title="Represent this passage: adds a card for it">Include</button>);
    return buttons.length ? <div className="acute-source__actions">{buttons}</div> : null;
  };

  const renderSegment = (seg: Segment, i: number) => {
    const text = data.text.slice(seg.start, seg.end);
    if (seg.kind === "text") {
      if (!seg.passage) return text;
      const isCurrent = current?.key === seg.passage;
      return (
        <mark key={i} className={`acute-source__unit is-selected${isCurrent ? " is-current" : ""}`} data-passage={seg.passage} aria-current={isCurrent ? "true" : undefined}>
          {text}
        </mark>
      );
    }
    return <UnitMark key={i} seg={seg} text={text} current={current?.key === seg.unit} active={activeUnit === seg.unit} />;
  };

  const renderRow = (row: Row) => {
    const section = view.sections[row.section]!;
    if (row.kind === "heading") {
      const level = Math.max(1, Math.min(6, section.level));
      const indent = { paddingLeft: `${(level - 1) * 10 + 4}px` };
      if (filter !== "all") {
        return (
          <div key={row.key} data-row-key={row.key} ref={measureRow} className="acute-source__heading acute-source__heading--static" style={indent} role="heading" aria-level={Math.min(6, level + 2)}>
            {section.heading}
          </div>
        );
      }
      return (
        <div key={row.key} data-row-key={row.key} ref={measureRow} role="heading" aria-level={Math.min(6, level + 2)}>
          <button type="button" className="acute-source__heading" style={indent} aria-expanded={row.open} onClick={() => toggleSection(section, row.open)}>
            <span className="acute-source__chevron" aria-hidden="true">
              {row.open ? "▾" : "▸"}
            </span>
            <span className="acute-source__heading-text">{section.heading}</span>
            {!row.open && <SectionCounts counts={section.counts} />}
          </button>
        </div>
      );
    }
    if (row.kind === "chunk") {
      return (
        <p key={row.key} data-row-key={row.key} ref={measureRow} className="acute-source__chunk">
          {section.segments.slice(row.from, row.to).map((seg, i) => renderSegment(seg, row.from + i))}
        </p>
      );
    }
    const seg = section.segments[row.segment] as UnitSegment;
    return (
      <div key={row.key} data-row-key={row.key} ref={measureRow} className="acute-source__item">
        <p className="acute-source__chunk">{renderSegment(seg, row.segment)}</p>
        <p className="acute-source__reason">
          {seg.outcome ? OUTCOME_LABEL[seg.outcome] : "No outcome recorded"}
          {seg.reasons.length ? ` · ${seg.reasons.join("; ")}` : ""}
        </p>
        {actionsFor(seg.unit)}
      </div>
    );
  };

  const outdated = data.latestVersion > data.version;
  const activeSegmentOutcome = activeUnit ? data.outcome[activeUnit] : undefined;
  const activeText = activeUnit ? view.unitById.get(activeUnit)?.text : undefined;
  const emptyFilter = filter !== "all" && rows.length === 0;

  return (
    <section className="acute-source" aria-label="Source">
      <header className="acute-source__header">
        <p className="acute-source__meta">
          Version {data.version}
          {data.units.length > 0 && <span className="acute-source__totals"> · {countsText(totals)}</span>}
        </p>
      </header>

      {outdated && (
        <div className="acute-source__updated" role="status">
          <p>Source updated since this card</p>
          <div className="acute-source__actions">
            {onViewLatest && (
              <button type="button" onClick={onViewLatest} title={`Show version ${data.latestVersion}`}>
                View latest
              </button>
            )}
            {changes && data.lineage && (
              <button type="button" aria-expanded={showChanges} aria-controls="acute-source-changes" onClick={() => setShowChanges((s) => !s)}>
                What changed
              </button>
            )}
          </div>
          {showChanges && changes && (
            <div id="acute-source-changes" className="acute-source__changes">
              <p>{describeChanges(changes) || "No passage this card's version has changed."}</p>
              {changes.items.length > 0 && (
                <ul>
                  {changes.items.map((item) => (
                    <li key={`${item.state}:${item.unit}`}>
                      <button type="button" onClick={() => jumpToUnit(item.unit)} title="Show this passage">
                        <span className={`acute-source__change acute-source__change--${item.state}`}>{CHANGE_LABEL[item.state]}</span> {item.excerpt}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {view.sections.some((s) => s.heading) && (
        <details className="acute-source__outline" open={view.sections.length <= 12 ? true : undefined}>
          <summary>Outline</summary>
          <ol>
            {view.sections
              .filter((s) => s.heading)
              .map((s) => (
                <li key={s.index} style={{ paddingLeft: `${(Math.max(1, s.level) - 1) * 10}px` }}>
                  <button type="button" onClick={() => jumpToSection(s.index)} title="Jump to this section">
                    <span className="acute-source__heading-text">{s.heading}</span>
                    <SectionCounts counts={s.counts} />
                  </button>
                </li>
              ))}
          </ol>
        </details>
      )}

      {data.units.length > 0 && (
        <div className="acute-source__filters" role="group" aria-label="Show passages">
          {FILTERS.map((f) => {
            const n = filterCount(f.id);
            return (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => chooseFilter(f.id)}>
                {f.label}
                {n !== null && <span className="acute-source__count"> {n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {view.passages.length > 1 && (
        <div className="acute-source__stepper" role="group" aria-label="Cited passages">
          <button type="button" onClick={() => stepBy(-1)} aria-label="Previous passage">
            ‹
          </button>
          <span aria-live="polite">
            Passage {stepIndex + 1} of {view.passages.length}
          </span>
          <button type="button" onClick={() => stepBy(1)} aria-label="Next passage">
            ›
          </button>
        </div>
      )}

      <div ref={bodyRef} className="acute-source__body" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} onClick={onBodyClick} onKeyDown={onBodyKey}>
        {emptyFilter ? (
          <p className="acute-source__message">{filter === "needs_review" ? "Nothing needs review." : filter === "omitted" ? "Nothing was left out." : "Every passage is on the canvas."}</p>
        ) : (
          <>
            <div aria-hidden="true" style={{ height: offsets[first] ?? 0 }} />
            {rows.slice(first, last + 1).map(renderRow)}
            <div aria-hidden="true" style={{ height: Math.max(0, total - (offsets[last + 1] ?? total)) }} />
          </>
        )}
      </div>

      {filter === "all" && activeUnit && activeText !== undefined && (
        <div className="acute-source__active" aria-label="Passage">
          <p className="acute-source__reason">
            {activeSegmentOutcome ? OUTCOME_LABEL[activeSegmentOutcome] : "No outcome recorded"}
            {(data.reasons[activeUnit] ?? []).length ? ` · ${data.reasons[activeUnit]!.join("; ")}` : ""}
          </p>
          <p className="acute-source__excerpt">{excerptOf(activeText, 140)}</p>
          {actionsFor(activeUnit)}
        </div>
      )}
    </section>
  );
}

function SectionCounts({ counts }: { counts: OutcomeCounts }) {
  return (
    <span className="acute-source__counts" title={countsText(counts)}>
      <span className="acute-source__sr">{countsText(counts)}</span>
      <span aria-hidden="true">
        {counts.represented}
        {counts.omitted > 0 && <span className="acute-source__dot acute-source__dot--omitted"> {counts.omitted}</span>}
        {counts.needs_review > 0 && <span className="acute-source__dot acute-source__dot--review"> {counts.needs_review}</span>}
      </span>
    </span>
  );
}

function UnitMark({ seg, text, current, active }: { seg: UnitSegment; text: string; current: boolean; active: boolean }) {
  const outcome = seg.outcome;
  const reason = seg.reasons.join("; ");
  const label = outcome && outcome !== "represented" ? `${OUTCOME_LABEL[outcome]}${reason ? `: ${reason}` : ""}` : undefined;
  const cls = ["acute-source__unit", outcome === "omitted" && "acute-source__unit--omitted", outcome === "needs_review" && "acute-source__unit--review", seg.selected && "is-selected", current && "is-current", active && "is-active"].filter(Boolean).join(" ");
  return (
    <span className={cls} data-unit={seg.unit} data-passage={seg.selected ? seg.unit : undefined} title={label} aria-current={current ? "true" : undefined} tabIndex={seg.selected || active ? 0 : undefined}>
      {text}
      {label && <span className="acute-source__sr"> ({label})</span>}
    </span>
  );
}
