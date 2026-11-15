"use client";

/**
 * Dev-only demo for the Phase 1 OpenUI spike (`.ai/docs/open-intelligent-ui-audit.md`, Option A). Not linked from
 * app nav, not part of the canvas or Visualize — renders `acuteCardLibrary` through the real
 * `@openuidev/react-lang` runtime on static fixture text, so the rendering + streaming behaviour can be watched
 * in a browser. No model calls.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NotesHostProvider, type NotesHost } from "@/ai/openui/hostContext";
import { flashcardLang, quizLang, type StudyNote } from "@/ai/openui/study";
import { OpenUiCardRenderer } from "@/components/openui/OpenUiCardRenderer";
import "@/components/openui/interactions.css";

// Same fixture validated in src/ai/openui/library.test.tsx.
const STREAM_FIXTURE = `
root = IdeaCard("Idempotency keys prevent duplicate charges", "When a client retries a payment request after a timeout, the server matches the request's idempotency key and returns the original result instead of charging twice.", "high", [c1, c2])
c1 = CitationChip("u4")
c2 = CitationChip("u7", "u7")
`.trim();

const STATIC_CARDS = {
  idea: `root = IdeaCard("Keys expire after a fixed window", "Idempotency protection only lasts while the server still remembers the key; after the window closes, a retry is treated as a brand new payment.", "medium", [c1])\nc1 = CitationChip("u7", "u7")`,
  calloutWarn: `root = Callout("warning", "Needs review: the source's 24-hour window was not cited by any card.")`,
  calloutInfo: `root = Callout("info", "Checked by AI: this section's cards were verified against 3 source units.")`,
  table: `root = ComparisonTable(["Queue", "Ordering", "Max delay"], [["SQS Standard", "Best-effort", "Minutes"], ["SQS FIFO", "Strict per group", "Minutes"], ["Kafka", "Strict per partition", "Hours+"]])`,
  source: `root = SourceLink("u7", "u7")`,
};

// Phase 3 knowledge-interaction cards (src/ai/openui/interactions.tsx), static Lang — no model calls.
const PHASE3_CARDS = {
  decision: `root = DecisionCard("Which queue should orders use?", [a, b, c], "SQS FIFO", "Orders need strict per-customer ordering; throughput is well under the FIFO limit.", ["u3"])
a = DecisionOption("SQS Standard", ["Cheap", "Unlimited throughput"], ["Best-effort ordering"])
b = DecisionOption("SQS FIFO", ["Strict ordering per group"], ["300 msg/s per group"])
c = DecisionOption("Kafka", ["Replay", "Strict per partition"], ["Ops overhead"])`,
  timeline: `root = Timeline("Blue-green rollout", [e1, e2, e3])
e1 = TimelineEvent("Mon", "Green deployed beside blue", "No traffic yet; smoke tests only.", "u2")
e2 = TimelineEvent("Tue", "5% canary", "Error rate held at baseline for 24 hours.")
e3 = TimelineEvent("Wed", "Full switch")`,
  flow: `root = FlowDiagram("Idempotent retry", ["Client sends key", "Server looks up key", "Replay or execute", "Store response"], ["Generated once per logical request.", "Keyed per merchant.", "A hit replays the stored response; a miss runs the charge.", "Kept for the 24-hour window."])`,
  links: `root = NoteLink("n2")`,
};

const STUDY_NOTES: StudyNote[] = [
  { id: "n1", title: "Idempotency keys prevent duplicate charges", body: "A retry with the same key returns the original result instead of charging twice.", cites: ["u4"] },
  { id: "n2", title: "Keys expire after a fixed window", body: "After the window closes, a retry is treated as a brand new payment.", cites: ["u7"] },
  { id: "n3", title: "Store the response, not just the key", body: "The server replays the stored response body and status code.", cites: [] },
];

const DEMO_UNITS: Record<string, string> = {
  u2: "Green is deployed next to blue and receives no user traffic until it passes smoke tests.",
  u3: "FIFO queues guarantee order within a message group, up to 300 messages per second per group.",
  u4: "If the same idempotency key is received again, the stored result is returned.",
  u7: "Keys are retained for 24 hours.",
};

const CHUNK_CHARS = 18;
const CHUNK_DELAY_MS = 220;

export default function OpenUiDemoPage() {
  const [streamedText, setStreamedText] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(true);
  const indexRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      indexRef.current += CHUNK_CHARS;
      if (indexRef.current >= STREAM_FIXTURE.length) {
        setStreamedText(STREAM_FIXTURE);
        setStreaming(false);
        clearInterval(id);
        return;
      }
      setStreamedText(STREAM_FIXTURE.slice(0, indexRef.current));
    }, CHUNK_DELAY_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <main style={page}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>OpenUI card renderer — Phase 1 spike</h1>
      <p style={{ color: "#6b727e", marginTop: 0, marginBottom: 32, fontSize: 14 }}>
        Dev-only demo page, not linked from the app nav. Renders <code>acuteCardLibrary</code> through the real{" "}
        <code>@openuidev/react-lang</code> runtime on static fixture text — no model calls.
      </p>

      <section data-testid="stream-demo" data-streaming={streaming ? "true" : "false"} style={{ marginBottom: 48 }}>
        <h2 style={sectionTitle}>1. Streaming a card in (isStreaming = {String(streaming)})</h2>
        <OpenUiCardRenderer response={streamedText} isStreaming={streaming} />
      </section>

      <section data-testid="component-gallery" style={{ marginBottom: 48 }}>
        <h2 style={sectionTitle}>2. All 5 components, rendered complete</h2>
        <div style={{ display: "grid", gap: 14 }}>
          <OpenUiCardRenderer response={STATIC_CARDS.idea} />
          <OpenUiCardRenderer response={STATIC_CARDS.calloutWarn} />
          <OpenUiCardRenderer response={STATIC_CARDS.calloutInfo} />
          <OpenUiCardRenderer response={STATIC_CARDS.table} />
          <OpenUiCardRenderer response={STATIC_CARDS.source} />
        </div>
      </section>

      <Phase3Section />

      <style>{CSS}</style>
    </main>
  );
}

function Phase3Section() {
  const [visited, setVisited] = useState<string | null>(null);
  const host: NotesHost = {
    unitText: (u) => DEMO_UNITS[u],
    navigate: (id) => setVisited(id),
    noteTitle: (id) => STUDY_NOTES.find((n) => n.id === id)?.title,
  };
  return (
    <section data-testid="phase3-gallery" style={{ marginBottom: 48 }}>
      <h2 style={sectionTitle}>3. Knowledge interactions (Phase 3) — local state only, no model calls</h2>
      <NotesHostProvider value={host}>
        <div style={{ display: "grid", gap: 14 }}>
          <OpenUiCardRenderer response={PHASE3_CARDS.decision} />
          <OpenUiCardRenderer response={PHASE3_CARDS.timeline} />
          <OpenUiCardRenderer response={PHASE3_CARDS.flow} />
          <OpenUiCardRenderer response={quizLang(STUDY_NOTES, 0)} />
          <OpenUiCardRenderer response={flashcardLang(STUDY_NOTES[1]!)} />
          <div data-testid="note-link-demo">
            <OpenUiCardRenderer response={PHASE3_CARDS.links} />
            {visited && <p style={{ fontSize: 13, color: "#6b727e", margin: "6px 0 0" }}>Navigated to note {visited}</p>}
          </div>
        </div>
      </NotesHostProvider>
    </section>
  );
}

const page: CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "40px 24px 80px",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  color: "#14171c",
  background: "#fbfbfc",
  minHeight: "100vh",
};

const sectionTitle: CSSProperties = { fontSize: 15, fontWeight: 640, color: "#3a4049", marginBottom: 12 };

const CSS = `
.openui-idea-card { border: 1px solid #d4d8df; border-radius: 10px; padding: 16px 18px; background: #fff; }
.openui-idea-card[data-importance="high"] { border-left: 3px solid #0e8f8a; }
.openui-idea-card[data-importance="medium"] { border-left: 3px solid #b9770e; }
.openui-idea-card__title { margin: 0 0 6px; font-size: 15px; }
.openui-idea-card__body { margin: 0 0 10px; color: #3a4049; font-size: 14px; line-height: 1.5; }
.openui-idea-card__citations { display: flex; gap: 6px; flex-wrap: wrap; }
.openui-citation-chip { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11px; background: #e4f3f2; color: #0a6b67; border-radius: 100px; padding: 2px 8px; }
.openui-source-link { font-family: inherit; font-size: 13px; background: #fff; border: 1px solid #d4d8df; border-radius: 8px; padding: 6px 12px; cursor: pointer; color: #0a6b67; }
.openui-callout { margin: 0; border-radius: 8px; padding: 12px 14px; font-size: 13.5px; border: 1px solid; }
.openui-callout[data-tone="warning"] { background: #f7efde; border-color: #e3c98a; color: #8a5a00; }
.openui-callout[data-tone="info"] { background: #e4f3f2; border-color: #9ad8d4; color: #0a6b67; }
.openui-callout[data-tone="success"] { background: #e8f3ec; border-color: #9bd1ae; color: #1d6b3c; }
.openui-comparison-table { border-collapse: collapse; width: 100%; font-size: 13px; background: #fff; border: 1px solid #d4d8df; border-radius: 10px; overflow: hidden; }
.openui-comparison-table th, .openui-comparison-table td { border-bottom: 1px solid #e3e6eb; padding: 8px 10px; text-align: left; }
.openui-comparison-table th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b727e; }
`;
