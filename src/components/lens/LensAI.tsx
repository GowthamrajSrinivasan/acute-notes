"use client";

/**
 * AI in Lens (plan §6, Phase 5): the **✨ Explain** node action, **✨ Generate L3** for a node with no detail level (or
 * **Ask your IDE agent** when the level is code-grounded), and the **Ask Lens** box. Everything is optional (§6): with
 * AI off, none of it shows and Lens works on what the canvas holds. Every call goes through `AIRuntime` on the user's
 * own connection (D18); nothing is written to a canvas without the user's Accept (D6).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { getConversationStore } from "@/ai/conversations/conversationStore";
import { AIError } from "@/ai/errors";
import { assessInput, explainInput, isCodeGrounded, matchQuestion, navigateCandidates, navigateNodes, navigateTarget, nextLevel, resolveAssessment, resolveNavigate, reviewInput, structureFacts } from "@/ai/lens/lensAI";
import "@/ai/lens/lensTasks";
import {
  LENS_AI_LIMITS,
  LENS_REVIEW_TOPICS,
  LENS_VERDICTS,
  lensNavigateDecision,
  type LensAssessInput,
  type LensAssessOutput,
  type LensExplainInput,
  type LensNavigateInput,
  type LensNavigateOutput,
  type LensReviewInput,
  type LensReviewTopic,
} from "@/ai/lens/lensTasks";
import { localSignal, questionsFor, reviewContext, trackForLevel, type LocalSignal, type ReviewQuestion, type ReviewTrack } from "@/ai/lens/reviewQuestions";
import { AI_PROVIDER_DESCRIPTORS } from "@/ai/providers/registry";
import { loadDefaultParser } from "@/ai/renderer/render";
import { AIRuntime } from "@/ai/runtime";
import { unwrapMarkdownFence } from "@/ai/selection/actions";
import { aiPanel, useAIMode } from "@/components/ai/askAI";
import { newId } from "@/domain/ids";
import { lensTree, type FrameRef, type LensLevelView, type LensNode, type SceneSource } from "@/domain/lens/lensView";
import type { DocumentHome } from "@/domain/types";
import { expandLensNodePrompt } from "@/mcp/tools/repoMap/prompt";
import { lensPanel } from "@/state/lensPanel";
import { canvasPath } from "@/workspaces/paths";
import { generateLevel } from "./lensGenerate";

/** The user-facing wording of a failed AI call (the same cases Ask AI words). */
export function aiErrorText(err: unknown): string {
  if (err instanceof AIError) {
    const messages: Partial<Record<AIError["kind"], string>> = {
      auth: "Your AI connection needs to sign in again.",
      quota_exhausted: "Your AI plan's allowance is used up.",
      rate_limited: "The AI provider is rate limiting requests. Try again shortly.",
      model_unavailable: err.message,
      network: "Couldn't reach the AI provider. Check your connection.",
      timeout: "The AI provider took too long to respond.",
      invalid_output: "The AI response couldn't be used. Try again.",
      disabled: "AI is turned off.",
      cancelled: "Cancelled.",
    };
    return messages[err.kind] ?? err.message;
  }
  console.error("[acute-notes] Lens AI failed", err);
  return "Something went wrong. Nothing was changed.";
}

export function useLensAI(): boolean {
  return useAIMode() === "on";
}

/** "AI-generated, not verified" (§6.3) on a node an AI plan made, until someone edits it into their own. */
export function AIGeneratedNote({ node }: { node: LensNode }) {
  if (!node.evidence.some((e) => e.source === "canvas" && e.origin === "ai")) return null;
  return (
    <p className="acute-lens-ai__note" role="note">
      ✨ AI-generated, not verified
    </p>
  );
}

type Run<T> = { status: "idle" } | { status: "running" } | { status: "done"; value: T } | { status: "error"; message: string };

interface Explanation {
  text: string;
  conversationId: string | null;
  provider: string;
  model: string;
}

/** ✨ Explain (§6.1): a short explanation in the inspector, saved as an Ask AI conversation; "Add as note" proposes a card. */
export function LensExplain({ home, view, node, detailLabels }: { home: DocumentHome; view: LensLevelView; node: LensNode; detailLabels: readonly string[] }) {
  const [run, setRun] = useState<Run<Explanation>>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);
  const onOpenCanvas = view.frame.canvasId === home.canvasId;

  const explain = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRun({ status: "running" });
    try {
      const input = explainInput(view, node, detailLabels);
      const r = await AIRuntime.run<LensExplainInput, string>("lens_explain", input, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const text = unwrapMarkdownFence(r.data);
      // Saved like an Ask AI exchange (§6.1), so it can be reopened from the conversation history.
      const store = getConversationStore();
      const operationId = newId("op");
      const conv = store.start({ workspaceId: home.workspaceId, canvasId: view.frame.canvasId, anchorIds: [node.id], anchorLabel: node.label, scope: "selection" });
      await store.recordExchange(
        conv.id,
        { action: "lens_explain", text: `Explain ${node.label} (Lens, ${input.level})`, scope: "selection", sourceIds: [node.id] },
        { kind: "note", title: `Explanation: ${node.label}`, text, provenance: { task: "lens_explain", providerId: r.providerId, role: r.role, model: r.usage.model, operationId } },
      );
      setRun({ status: "done", value: { text, conversationId: store.isSaved(conv.id) ? conv.id : null, provider: r.providerId, model: r.usage.model } });
    } catch (err) {
      if (!controller.signal.aborted) setRun({ status: "error", message: aiErrorText(err) });
    }
  };

  /** Proposes the explanation as a card beside the node, linked `explained_by` (§6.1): reviewed like any change. */
  const addAsNote = async (e: Explanation) => {
    const parse = await loadDefaultParser();
    const operationId = newId("op");
    const authType = AI_PROVIDER_DESCRIPTORS.find((d) => d.id === e.provider)?.accessType;
    getPendingChanges().propose(home.canvasId, {
      operationId,
      title: `Lens: explanation of ${node.label}`,
      metadata: { createdBy: "ai", task: "lens_explain", operationId, provider: e.provider, model: e.model, ...(authType ? { authType } : {}) },
      changes: [
        { kind: "create_block", key: "note", blockType: "text", content: parse(e.text), box: { x: node.box.x + node.box.width + 80, y: node.box.y, width: 340, height: 220 } },
        { kind: "connect", key: "link", from: { existing: node.id }, to: { created: "note" }, relation: "explained_by" },
      ],
    });
  };

  return (
    <>
      <button type="button" className="acute-lens-panel__zoom-in" disabled={run.status === "running"} onClick={() => void explain()}>
        {run.status === "running" ? "Explaining…" : "✨ Explain"}
      </button>
      {run.status !== "idle" && (
        <section className="acute-lens-overlay acute-lens-ai" aria-label="Explanation" data-full-row="">
          <div className="acute-lens-overlay__head">
            <span>✨ {node.label}</span>
            <button
              type="button"
              onClick={() => {
                abort.current?.abort();
                setRun({ status: "idle" });
              }}
            >
              {run.status === "running" ? "Cancel" : "Close"}
            </button>
          </div>
          {run.status === "running" && <p className="acute-lens-overlay__muted">Explaining with your AI connection…</p>}
          {run.status === "error" && <p className="acute-lens-overlay__warning">{run.message}</p>}
          {run.status === "done" && (
            <>
              <div className="acute-lens-ai__text">{run.value.text}</div>
              <p className="acute-lens-overlay__muted">AI-generated from what Lens shows; not verified against the code.</p>
              <div className="acute-lens-drawer__actions">
                {onOpenCanvas && (
                  <button type="button" onClick={() => void addAsNote(run.value)}>
                    Add as note
                  </button>
                )}
                {run.value.conversationId && (
                  <button type="button" onClick={() => aiPanel.openChat({ conversationId: run.value.conversationId! })}>
                    Open in Ask AI
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}

/**
 * ✨ Generate the next level (§6.3) for a node with no detail level; for a code-grounded node, "Ask your IDE agent"
 * copies the `expand_lens_node` prompt instead (the in-app model can't see the code; the agent reads it on its own
 * subscription).
 */
export function LensGenerate({ api, home, view, node, root, path }: { api: ExcalidrawImperativeAPI; home: DocumentHome; view: LensLevelView; node: LensNode; root: FrameRef; path: readonly string[] }) {
  const router = useRouter();
  const [run, setRun] = useState<Run<string>>({ status: "idle" });
  const level = nextLevel(view);
  if (!level || node.childFrame || view.source) return null;

  if (isCodeGrounded(node)) {
    const copy = async () => {
      const text = expandLensNodePrompt({ key: node.key });
      try {
        await navigator.clipboard.writeText(text);
        setRun({ status: "done", value: "Copied. Paste it into Claude Code or Copilot: your IDE agent reads the code and sends this level for your review." });
      } catch {
        setRun({ status: "error", message: "Couldn't copy to the clipboard. Run the expand_lens_node prompt from your IDE agent instead." });
      }
    };
    return (
      <>
        <button type="button" className="acute-lens-panel__zoom-in" title={`This node cites code: your IDE agent can read it and send L${level.index}`} onClick={() => void copy()}>
          Ask your IDE agent for L{level.index}
        </button>
        {run.status === "done" && <p className="acute-lens-overlay__muted" role="status" data-full-row="">{run.value}</p>}
        {run.status === "error" && <p className="acute-lens-overlay__warning" data-full-row="">{run.message}</p>}
      </>
    );
  }

  const generate = async () => {
    setRun({ status: "running" });
    try {
      const out = await generateLevel({ runtime: AIRuntime, api, home, view, node, level, lens: { root, path: [...path] } });
      if (!out.ok) return setRun({ status: "error", message: out.reason });
      setRun({ status: "done", value: `Proposed on the Detail Canvas for your review${out.created ? " (created it)" : ""}.` });
      if (out.detailCanvasId !== home.canvasId) router.push(canvasPath(home.workspaceId, out.detailCanvasId));
    } catch (err) {
      setRun({ status: "error", message: aiErrorText(err) });
    }
  };
  return (
    <>
      <button type="button" className="acute-lens-panel__zoom-in" disabled={run.status === "running"} onClick={() => void generate()}>
        {run.status === "running" ? `Generating L${level.index}…` : `✨ Generate L${level.index} for ${node.label}`}
      </button>
      {run.status === "done" && <p className="acute-lens-overlay__muted" role="status" data-full-row="">{run.value}</p>}
      {run.status === "error" && <p className="acute-lens-overlay__warning" data-full-row="">{run.message}</p>}
    </>
  );
}

const REVIEW_LABELS: Record<LensReviewTopic, string> = {
  requirements: "Requirements",
  capacity: "Capacity estimate",
  scale: "What breaks at 10×?",
  failure: "Failure modes",
  tradeoffs: "Tradeoffs",
};

const CUSTOM_KEY = "acute.lens.reviewQuestions";
const SIGNAL_TEXT: Record<LocalSignal, string> = { seen: "Seen on diagram", "not-seen": "Not on diagram", unknown: "Can't tell from shape" };

function loadCustom(): ReviewQuestion[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CUSTOM_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((q): q is ReviewQuestion => !!q && typeof q.id === "string" && typeof q.text === "string").map((q) => ({ id: q.id, track: q.track === "lld" ? "lld" : "hld", category: "Mine", text: q.text })) : [];
  } catch {
    return [];
  }
}
function saveCustom(qs: readonly ReviewQuestion[]) {
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(qs.map(({ id, track, text }) => ({ id, track, text }))));
  } catch {
    /* private window or blocked storage: the questions last for this session */
  }
}

/**
 * Interview-style assessment: the questions an interviewer asks of an HLD (L0–L2) or LLD (L3–L5), as a table. The
 * diagram signal column is local (kinds and labels on this level) and shows at once; **Analyze** asks the model for a
 * verdict, answer and improvement per row over the level's graph. Users can add their own questions.
 */
function LensAssessment({ view, assumptions }: { view: LensLevelView; assumptions: string }) {
  const [track, setTrack] = useState<ReviewTrack>(trackForLevel(view.level));
  const [custom, setCustom] = useState<ReviewQuestion[]>(loadCustom);
  const [draft, setDraft] = useState("");
  const [run, setRun] = useState<Run<Map<string, LensAssessOutput["answers"][number]>>>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);

  const questions = [...questionsFor(track), ...custom.filter((q) => q.track === track)];
  const ctx = reviewContext(view.nodes, view.edges.flatMap((e) => [e.label, e.explanation].filter((t): t is string => !!t)), structureFacts(view));
  const answers = run.status === "done" ? run.value : undefined;

  const analyze = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRun({ status: "running" });
    try {
      const input = assessInput(view, track, questions, { assumptions });
      const r = await AIRuntime.run<LensAssessInput, LensAssessOutput>("lens_assess", input, { signal: controller.signal });
      if (!controller.signal.aborted) setRun({ status: "done", value: resolveAssessment(r.data, questions) });
    } catch (err) {
      if (!controller.signal.aborted) setRun({ status: "error", message: aiErrorText(err) });
    }
  };
  const addQuestion = () => {
    const text = draft.trim();
    if (!text) return;
    const next = [...custom, { id: `custom.${newId("op")}`, track, category: "Mine", text: text.slice(0, LENS_AI_LIMITS.question) }];
    setCustom(next);
    saveCustom(next);
    setDraft("");
  };
  const removeQuestion = (id: string) => {
    const next = custom.filter((q) => q.id !== id);
    setCustom(next);
    saveCustom(next);
  };
  const tally = answers ? questions.reduce<Record<string, number>>((t, q) => ({ ...t, [answers.get(q.id)?.verdict ?? "unknown"]: (t[answers.get(q.id)?.verdict ?? "unknown"] ?? 0) + 1 }), {}) : null;

  return (
    <section className="acute-lens-assess" aria-label="Interview-style assessment">
      <div className="acute-lens-drawer__actions" role="tablist" aria-label="Question set">
        {(["hld", "lld"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={track === t} onClick={() => { setTrack(t); setRun({ status: "idle" }); }}>
            {t === "hld" ? "HLD questions (L0–L2)" : "LLD questions (L3–L5)"}
          </button>
        ))}
        <button type="button" disabled={run.status === "running"} onClick={() => void analyze()}>
          {run.status === "running" ? "Analyzing…" : `✨ Analyze ${questions.length} questions`}
        </button>
      </div>
      {tally && <p className="acute-lens-overlay__muted" role="status">{LENS_VERDICTS.filter((v) => tally[v]).map((v) => `${tally[v]} ${v}`).join(" · ")}</p>}
      {run.status === "error" && <p className="acute-lens-overlay__warning">{run.message}</p>}
      <table className="acute-lens-assess__table">
        <thead>
          <tr>
            <th>Question · on the diagram</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => {
            const a = answers?.get(q.id);
            const signal = localSignal(q, ctx);
            return (
              <tr key={q.id} data-verdict={a?.verdict}>
                <td>
                  <span className="acute-lens-overlay__muted">{q.category}</span>
                  <div>{q.text}</div>
                  <span className="acute-lens-assess__signal" data-signal={signal}>
                    {SIGNAL_TEXT[signal]}
                  </span>
                  {a && <div>{a.answer}</div>}
                  {a?.improve && <div className="acute-lens-overlay__muted">↳ Improve: {a.improve}</div>}
                  {q.id.startsWith("custom.") && (
                    <button type="button" aria-label={`Remove question: ${q.text}`} onClick={() => removeQuestion(q.id)}>
                      Remove
                    </button>
                  )}
                </td>
                <td>{a ? a.verdict : run.status === "running" ? "…" : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form className="acute-lens-ask" onSubmit={(e) => { e.preventDefault(); addQuestion(); }}>
        <input aria-label="Add a question" placeholder={`Add your own ${track.toUpperCase()} question…`} value={draft} maxLength={LENS_AI_LIMITS.question} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" disabled={!draft.trim()}>Add</button>
      </form>
      {run.status === "done" && <p className="acute-lens-overlay__muted">AI-generated from this level and your figures; not verified against the code.</p>}
    </section>
  );
}

/**
 * ✨ Design review: the level on screen reviewed against one design question (requirements, capacity, scale, failure,
 * tradeoffs). The model sees the level's graph and structure computed from it plus the user's own figures, and labels
 * anything else an assumption. Nothing is written to a canvas.
 */
export function LensReview({ view }: { view: LensLevelView }) {
  const [assumptions, setAssumptions] = useState("");
  const [question, setQuestion] = useState("");
  const [factor, setFactor] = useState(10);
  const [run, setRun] = useState<Run<{ topic: LensReviewTopic; text: string }>>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);
  // Architecture questions make no sense over decisions and progress items (the Project profile).
  if (view.source || view.profile.id !== "architecture" || !view.nodes.length) return null;

  const review = async (topic: LensReviewTopic) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRun({ status: "running" });
    try {
      const input = reviewInput(view, topic, { question, assumptions, ...(topic === "scale" ? { factor } : {}) });
      const r = await AIRuntime.run<LensReviewInput, string>("lens_review", input, { signal: controller.signal });
      if (!controller.signal.aborted) setRun({ status: "done", value: { topic, text: unwrapMarkdownFence(r.data) } });
    } catch (err) {
      if (!controller.signal.aborted) setRun({ status: "error", message: aiErrorText(err) });
    }
  };
  const busy = run.status === "running";

  return (
    <details className="acute-lens-review">
      <summary>✨ Design review</summary>
      <div className="acute-lens-review__form">
        <input aria-label="Assumptions" placeholder="Your numbers: 2M DAU, 5% at peak, read-heavy…" value={assumptions} maxLength={LENS_AI_LIMITS.assumptions} onChange={(e) => setAssumptions(e.target.value)} />
        <LensAssessment view={view} assumptions={assumptions} />
        <input aria-label="Review question" placeholder="Or ask: what if the cart service goes down?" value={question} maxLength={LENS_AI_LIMITS.question} onChange={(e) => setQuestion(e.target.value)} />
        <label>
          Growth ×
          <input aria-label="Growth factor" type="number" min={2} max={1000} value={factor} onChange={(e) => setFactor(Math.min(1000, Math.max(2, Number(e.target.value) || 10)))} />
        </label>
        <div className="acute-lens-drawer__actions">
          {LENS_REVIEW_TOPICS.map((t) => (
            <button key={t} type="button" disabled={busy} onClick={() => void review(t)}>
              {t === "scale" ? `What breaks at ${factor}×?` : REVIEW_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {busy && <p className="acute-lens-overlay__muted">Reviewing with your AI connection…</p>}
      {run.status === "error" && <p className="acute-lens-overlay__warning">{run.message}</p>}
      {run.status === "done" && (
        <section className="acute-lens-ai" aria-label={`${REVIEW_LABELS[run.value.topic]} review`}>
          <div className="acute-lens-ai__text">{run.value.text}</div>
          <p className="acute-lens-overlay__muted">AI-generated from this level and your figures; not verified against the code. Figures it adds are assumptions.</p>
        </section>
      )}
    </details>
  );
}

/**
 * Ask Lens (§6.2): "how do payments affect orders?" names nodes locally first; only when nothing matches, and AI is on,
 * the model maps the question onto keys (labels and keys only). Lens then opens at the lowest level both share, with
 * the trace between them (or the one node selected).
 */
export function LensAsk({ scenes, root, aiOn }: { scenes: SceneSource; root: FrameRef; aiOn: boolean }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<{ status: "idle" | "running" } | { status: "message"; text: string }>({ status: "idle" });

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    const tree = lensTree(scenes, root);
    const candidates = tree ? navigateCandidates(tree) : [];
    if (!candidates.length) return setState({ status: "message", text: "Nothing to search in this view yet." });
    let answer: LensNavigateOutput = matchQuestion(q, candidates);
    let viaAI = false;
    if (!answer.from && aiOn) {
      setState({ status: "running" });
      try {
        const r = await AIRuntime.decide<LensNavigateInput, LensNavigateOutput>(lensNavigateDecision, { question: q.slice(0, 300), nodes: navigateNodes(candidates) });
        answer = resolveNavigate(r.data, candidates);
        viaAI = true;
      } catch (err) {
        return setState({ status: "message", text: aiErrorText(err) });
      }
    }
    const from = candidates.find((c) => c.key === answer.from);
    if (!from) return setState({ status: "message", text: aiOn ? "No node in this view fits that question." : "No node in this view is named in that question. Turn on AI to ask in your own words." });
    const to = candidates.find((c) => c.key === answer.to);
    const at = navigateTarget(from, to);
    lensPanel.open(root, { path: at.path, nodeKey: at.nodeKey, ...(to ? {} : { highlight: [from.key] }) });
    if (to) {
      lensPanel.startTrace({ canvasId: from.canvasId, key: from.key, label: from.label });
      lensPanel.traceTo({ canvasId: to.canvasId, key: to.key, label: to.label });
    }
    setState({ status: "message", text: `${to ? `${from.label} → ${to.label}` : from.label}${viaAI ? " (found with AI)" : ""}` });
  };

  return (
    <form
      className="acute-lens-ask"
      role="search"
      aria-label="Ask Lens"
      onSubmit={(e) => {
        e.preventDefault();
        void ask();
      }}
    >
      <input aria-label="Question for Lens" placeholder="Ask Lens: how do payments affect orders?" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={state.status === "running"} />
      {state.status === "running" && <span className="acute-lens-overlay__muted">Asking…</span>}
      {state.status === "message" && (
        <span className="acute-lens-overlay__muted" role="status">
          {state.text}
        </span>
      )}
    </form>
  );
}
