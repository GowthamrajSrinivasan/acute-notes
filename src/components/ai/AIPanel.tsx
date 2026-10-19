"use client";

/**
 * The AI side panel (F18 Ask AI + F40 conversations), docked on the right of
 * the canvas with three tabs:
 *
 * - Chat (✨ Ask AI): a question box, explicit scope and the action list for
 *   the current selection; then the conversation — each reply insertable on
 *   the canvas — with a formatted live preview, Cancel, and follow-ups.
 * - History (the clock button): the selection's conversations, or every
 *   conversation on the canvas; search, open/continue, export, delete.
 * - Agent log (Agent State, Lens Phase 7A): every change set accepted,
 *   rejected or left to expire, by session, with "Show on canvas" and
 *   "Revert…" (`AgentHistoryTab`).
 *
 * Nothing reaches the canvas until the user chooses Insert, which proposes an
 * AI change set (F19): the block is previewed on the canvas and only written
 * — as an ordinary, editable block carrying `metadata.ai`, in one undo step —
 * when the user accepts it in the review bar (`ChangeSetReview`). Every AI
 * call goes through `AIRuntime.run`; the canvas stays fully usable while a
 * request runs, and streamed tokens only ever update the preview. Completed
 * exchanges are saved to this device unless saving is off; a cancelled one
 * leaves nothing behind.
 */
import { AgentHistoryTab } from "./AgentHistoryTab";
import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getAIMode, subscribeAIMode } from "@/ai/aiMode";
import * as connections from "@/ai/connections";
import { getDescriptor, getPrimaryId } from "@/ai/connections";
import { getConversationStore } from "@/ai/conversations/conversationStore";
import { boundedHistory, formatAgo, tasksToMarkdown } from "@/ai/conversations/history";
import type { AIConversation, AITurn, AssistantTurn } from "@/ai/conversations/types";
import { buildAskContext, type AskContextSource } from "@/ai/context/contextBuilder";
import { selectedItems, type AIScope, type ContextCoverage, type ContextItem, type SelectionContext } from "@/ai/context/selectionContext";
import { AIError } from "@/ai/errors";
import { AIRuntime } from "@/ai/runtime";
import type { Box } from "@/ai/changes/changeSet";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import {
  effectiveScope,
  provenanceMetadata,
  runChat,
  runSelectionAction,
  SELECTION_ACTIONS,
  suggestionsFor,
  tasksToContent,
  unwrapMarkdownFence,
  type SelectionAction,
  type SelectionActionResult,
} from "@/ai/selection/actions";
import "@/ai/selection/selectionTasks";
import { BlockPreview } from "@/components/blocks/BlockPreview";
import { revealElement } from "@/components/canvas/pagePreviews";
import { ChevronDownIcon, CloseIcon, DownloadIcon, HistoryIcon, PlusIcon, SendIcon, SlidersIcon, SparkleIcon, TrashIcon } from "@/components/common/icons";
import { useSelection } from "@/components/properties/selectedBlockStore";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { getActiveEditor } from "@/components/blocks/activeEditors";
import { BLOCK_SIZE } from "@/domain/content/richContent";
import type { AIModel, AIProviderConfig } from "@/ai/types";
import type { DocumentHome, RichBlockType, RichContent } from "@/domain/types";
import { downloadText, fileSlug } from "@/portability/download";
import { getDocumentStore } from "@/state/documents";
import { aiPanel, openAISettings, useAIMode, useAIPanel, useConversationsVersion, useSaveConversations, type HistoryFilter } from "./askAI";
import { visualizeDialog } from "./visualizeStore";
import { loadLatest } from "@/ai/content/sources";
import { existingObjects, sectionsOfObjects, sourcesOf } from "@/ai/reconcile/existing";
import { rearrangeSource } from "@/ai/reconcile/rearrange";
import { newId } from "@/domain/ids";
import { freshIndex, useWorkspaceIndexer } from "@/search/liveIndex";
import { getPersistence } from "@/persistence";
import { prefersReducedMotion } from "@/components/canvas/motion";

const SCOPES: readonly { id: AIScope; label: string }[] = [
  { id: "selection", label: "Selection" },
  { id: "canvas", label: "This canvas" },
  { id: "workspace", label: "This workspace" },
];
const scopeLabel = (s: AIScope) => SCOPES.find((x) => x.id === s)!.label;

const PREVIEW_INTERVAL_MS = 100;
const GAP = 48;

type Parse = (markdown: string) => RichContent;

type ChatView =
  | { type: "menu" }
  | { type: "conversation"; id: string }
  | { type: "related"; scope: AIScope; result: Extract<SelectionActionResult, { kind: "related" }> };

type Pending =
  | { type: "running"; label: string; scope: AIScope; preview: string; previewContent: RichContent | null }
  | { type: "error"; message: string; settings: boolean; retry: () => void };

interface Request {
  controller: AbortController;
}

/** What the user asked: a menu action, or a typed question / follow-up. */
type Ask = { action: SelectionAction } | { message: string };

function errorMessage(err: unknown): { message: string; settings: boolean } {
  if (err instanceof AIError) {
    const settings = ["auth", "model_unavailable", "quota_exhausted", "disabled"].includes(err.kind);
    const messages: Partial<Record<AIError["kind"], string>> = {
      auth: "Your AI connection needs to sign in again.",
      quota_exhausted: "Your AI plan's allowance is used up.",
      rate_limited: "The AI provider is rate limiting requests. Try again shortly.",
      model_unavailable: err.message,
      network: "Couldn't reach the AI provider. Check your connection.",
      timeout: "The AI provider took too long to respond.",
      invalid_output: "The AI response couldn't be used. Try again.",
      disabled: "AI is turned off.",
    };
    return { message: messages[err.kind] ?? err.message, settings };
  }
  console.error("[acute-notes] Ask AI failed", err);
  return { message: "Something went wrong. Nothing was changed.", settings: false };
}

/** Box for a new block of `size` just right of the given elements, or at the viewport centre when none remain. */
function placementBeside(api: ExcalidrawImperativeAPI, ids: readonly string[], size: { width: number; height: number }): Box {
  const set = new Set(ids);
  const els = api.getSceneElements().filter((el) => set.has(el.id));
  if (!els.length) {
    const s = api.getAppState();
    return { x: s.width / 2 / s.zoom.value - s.scrollX - size.width / 2, y: s.height / 2 / s.zoom.value - s.scrollY - size.height / 2, ...size };
  }
  const maxX = Math.max(...els.map((el) => el.x + el.width));
  const minY = Math.min(...els.map((el) => el.y));
  return { x: maxX + GAP, y: minY, ...size };
}

/** "Checkout API", "Design doc: payment retries", "3 objects", or the scope when nothing is selected. */
function anchorLabelFor(items: readonly ContextItem[], scope: AIScope): string {
  if (!items.length) return scope === "workspace" ? "This workspace" : "This canvas";
  if (items.length !== 1) return `${items.length} objects`;
  const item = items[0]!;
  const text = item.title ?? item.text.replace(/^#+\s*/, "").split("\n")[0]!.trim();
  return text.length > 48 ? `${text.slice(0, 47)}…` : text || "Selection";
}

/**
 * Visualize's input for a single rich block whose editor has only part of its text selected (F31): that part, labelled
 * as a selection in the block. Null otherwise, and the whole selection is used.
 */
function partialBlockSelection(api: ExcalidrawImperativeAPI, items: readonly ContextItem[]): { text: string; label: string } | null {
  if (items.length !== 1) return null;
  const el = api.getSceneElements().find((e) => e.id === items[0]!.id);
  const ref = el ? getEmbedRef(el as unknown as SceneElement) : null;
  if (ref?.kind !== "rich-block") return null;
  const text = getActiveEditor(ref.documentId)?.selectedMarkdown();
  return text ? { text, label: `Selection in ${anchorLabelFor(items, "selection")}` } : null;
}

/** The selection's own content, for Visualize's dialog (F31) — each item's Markdown/text, titled where it has one. */
function sourceTextFor(items: readonly ContextItem[]): string {
  return items.map((i) => (i.title ? `## ${i.title}\n\n${i.text}` : i.text)).join("\n\n");
}

let parser: Promise<Parse> | null = null;
/** BlockNote's Markdown parser, loaded on first use. */
function loadParser(): Promise<Parse> {
  parser ??= import("@/components/blocks/editor/markdown").then((m) => m.markdownToContent);
  return parser;
}

export function AIPanel({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const panel = useAIPanel();
  const mode = useAIMode();
  // F22: the workspace search index, kept current in idle time while AI is on.
  useWorkspaceIndexer(api, home, mode !== "off");
  const saving = useSaveConversations();
  const version = useConversationsVersion();
  const selection = useSelection();
  const store = getConversationStore();

  const [scope, setScope] = useState<AIScope>("selection");
  const [view, setView] = useState<ChatView>({ type: "menu" });
  const [turns, setTurns] = useState<AITurn[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("selection");
  const requestRef = useRef<Request | null>(null);
  const [parse, setParse] = useState<Parse | null>(null);
  /** What the latest reply's context covered (F18): shown under the composer while its conversation is open. Not saved. */
  const [coverage, setCoverage] = useState<{ conversationId: string; coverage: ContextCoverage } | null>(null);

  const cancel = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setPending(null);
  }, []);

  const close = useCallback(() => {
    cancel();
    aiPanel.close();
  }, [cancel]);

  useEffect(() => () => aiPanel.close(), []);
  useEffect(() => subscribeAIMode(() => getAIMode() === "off" && close()), [close]);
  useEffect(() => void loadParser().then((p) => setParse(() => p)), []);
  useEffect(() => void store.load(home.workspaceId), [store, home.workspaceId]);

  const selectedIds = Object.keys(selection);
  // A selected frame stands for what is inside it: its contents are the selection's items and content sources.
  const sourceScope = new Set(selectedIds);
  for (const el of api.getSceneElements()) if (el.frameId && sourceScope.has(el.frameId)) sourceScope.add(el.id);
  const expandedSelection = Object.fromEntries([...sourceScope].map((id) => [id, true as const]));
  const items = selectedIds.length ? selectedItems(api.getSceneElements() as unknown as readonly SceneElement[], expandedSelection, (id) => getDocumentStore().get(id)) : [];
  // Content sources behind the selection (F37), for "Update from new content".
  const selectionSources = selectedIds.length ? sourcesOf(api.getSceneElements() as unknown as readonly SceneElement[], sourceScope, (id) => getDocumentStore().get(id)) : [];
  const hasSelection = items.length > 0;

  const openConversation = useCallback(
    async (id: string) => {
      cancel();
      aiPanel.setTab("chat");
      setView({ type: "conversation", id });
      setTurns(await store.getTurns(id));
      // Select what the conversation is about, so it's clear on the canvas.
      const anchors = store.get(id)?.anchorIds.filter((a) => api.getSceneElements().some((el) => el.id === a)) ?? [];
      if (anchors.length) {
        api.updateScene({ appState: { selectedElementIds: Object.fromEntries(anchors.map((a) => [a, true])) } });
        api.scrollToContent(
          api.getSceneElements().filter((el) => anchors.includes(el.id)),
          { animate: !prefersReducedMotion(), duration: 250 },
        );
      }
    },
    [cancel, store, api],
  );

  // Open requests: a saved conversation, a new chat, or History.
  const handledSeq = useRef(0);
  useEffect(() => {
    if (!panel.open || panel.seq === handledSeq.current) return;
    handledSeq.current = panel.seq;
    const { tab, conversationId, historyFilter, context } = panel;
    // Read now: the selection may change before the microtask runs.
    const selected = hasSelection;
    queueMicrotask(() => {
      if (tab === "chat" && conversationId) {
        void openConversation(conversationId);
      } else if (tab === "chat") {
        // A new chat about the current selection — unless a reply is on its way.
        if (!requestRef.current) {
          setView({ type: "menu" });
          setTurns([]);
          setPending(null);
          setScope(context === "auto" && !selected ? "canvas" : "selection");
        }
      } else {
        setQuery("");
        setFilter(historyFilter ?? (hasSelectionNow(api) ? "selection" : "all"));
      }
    });
    // Only a new open request (panel.seq) matters, not selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, openConversation, api]);

  const primaryName = (() => {
    const id = getPrimaryId();
    return id ? (getDescriptor(id)?.name ?? id) : null;
  })();

  const conversation: AIConversation | undefined = view.type === "conversation" ? store.get(view.id) : undefined;

  /**
   * Builds context for `ids` at `scope` from the live canvas (F22): the
   * selection, then nearby / in view, related, and search hits for
   * `question` from the workspace index, within the budget.
   */
  const contextFor = async (ids: string[], used: AIScope, question?: string): Promise<SelectionContext> => {
    const docs = getDocumentStore();
    if (used === "workspace") await Promise.all([docs.loadKind(home.workspaceId, "page"), docs.loadKind(home.workspaceId, "block")]);
    const elements = api.getSceneElements() as unknown as readonly SceneElement[];
    const getDocument = (id: string) => docs.get(id);
    const s = api.getAppState();
    const zoom = s.zoom.value || 1;
    const source: AskContextSource = {
      workspaceId: home.workspaceId,
      canvasId: home.canvasId,
      elements,
      selectedIds: ids,
      getDocument,
      listWorkspaceDocuments: () => [...docs.list(home.workspaceId, "page"), ...docs.list(home.workspaceId, "block")],
      question,
      viewport: { x: -s.scrollX, y: -s.scrollY, width: s.width / zoom, height: s.height / zoom },
      index: freshIndex(home.workspaceId),
      sameSourceAs: (selected) => {
        const set = new Set(selected);
        return sourcesOf(elements, set, getDocument).flatMap((src) => existingObjects(elements, getDocument, src).map((o) => o.objectId));
      },
    };
    return buildAskContext(source, used);
  };

  /** Runs one exchange — a menu action or a typed question — in `existing` (a new conversation when null). */
  const ask = async (what: Ask, existing: AIConversation | null, requested: AIScope = scope) => {
    cancel();
    const controller = new AbortController();
    const req: Request = { controller };
    requestRef.current = req;

    const alive = new Set(api.getSceneElements().map((el) => el.id));
    const anchorIds = existing ? existing.anchorIds.filter((id) => alive.has(id)) : Object.keys(api.getAppState().selectedElementIds);
    const used = "action" in what ? effectiveScope(what.action, requested) : (existing?.scope ?? requested);
    const label = "action" in what ? what.action.progress : "Thinking…";
    setPending({ type: "running", label, scope: used, preview: "", previewContent: null });

    // Find related is local and not part of a conversation.
    const local = "action" in what && !what.action.task;
    let conv = existing;
    let createdHere = false;
    try {
      const needsContext = "action" in what || anchorIds.length > 0 || used !== "selection";
      const context = needsContext ? await contextFor(anchorIds, used, "message" in what ? what.message : undefined) : null;
      if (controller.signal.aborted) return;

      if (!conv && !local) {
        const selectionItems = context ? context.items.filter((i) => context.selectedObjectIds.includes(i.id)) : [];
        conv = store.start({
          workspaceId: home.workspaceId,
          canvasId: home.canvasId,
          anchorIds: context?.selectedObjectIds ?? anchorIds,
          anchorLabel: anchorLabelFor(selectionItems, used),
          scope: used,
        });
        createdHere = true;
        setView({ type: "conversation", id: conv.id });
        setTurns([]);
      }

      let timer = 0;
      let lastRender = 0;
      let latest = "";
      const render = () => {
        timer = 0;
        lastRender = performance.now();
        if (requestRef.current !== req) return;
        const previewContent = parse ? parse(unwrapMarkdownFence(latest)) : null;
        setPending((p) => (p?.type === "running" ? { ...p, preview: latest, previewContent } : p));
      };
      const onText = (text: string) => {
        latest = text;
        timer ||= window.setTimeout(render, Math.max(0, PREVIEW_INTERVAL_MS - (performance.now() - lastRender)));
      };

      const opts = { signal: controller.signal, onText };
      const result =
        "action" in what
          ? await runSelectionAction(AIRuntime, what.action.id, context!, opts)
          : await runChat(AIRuntime, { context, scope: used, history: boundedHistory(await store.getTurns(conv!.id)).messages, message: what.message }, opts);
      clearTimeout(timer);
      if (requestRef.current !== req || controller.signal.aborted) return;

      if (result.kind === "related") {
        setView({ type: "related", scope: used, result });
        requestRef.current = null;
        setPending(null);
        return;
      }
      if (!conv) return;
      const sourceIds = context ? [...context.items, ...context.nearby].map((i) => i.id) : [];
      await store.recordExchange(
        conv.id,
        { action: "action" in what ? what.action.id : undefined, text: "action" in what ? what.action.label : what.message, scope: used, sourceIds },
        result.kind === "tasks"
          ? { kind: "tasks", title: result.title, text: tasksToMarkdown(result.tasks), tasks: result.tasks, provenance: result.provenance }
          : { kind: "note", title: result.title, text: result.markdown, provenance: result.provenance },
      );
      if (requestRef.current !== req) return;
      requestRef.current = null;
      setCoverage(context?.coverage ? { conversationId: conv.id, coverage: context.coverage } : null);
      setTurns(await store.getTurns(conv.id));
      setPending(null);
    } catch (err) {
      if (requestRef.current !== req) return;
      requestRef.current = null;
      // A new conversation with no reply yet is dropped (it was never saved);
      // retrying starts it afresh.
      const dropped = createdHere && conv !== null && store.get(conv.id)?.turnCount === 0;
      if (dropped) {
        void store.delete([conv!.id]);
        setView({ type: "menu" });
      }
      if (err instanceof AIError && err.kind === "cancelled") {
        setPending(null);
      } else {
        const { message, settings } = errorMessage(err);
        const retryIn = dropped || !conv ? null : (store.get(conv.id) ?? null);
        setPending({ type: "error", message, settings, retry: () => void ask(what, retryIn, requested) });
      }
    }
  };

  const send = () => {
    const message = draft.trim();
    if (!message || pending?.type === "running") return;
    setDraft("");
    void ask({ message }, conversation ?? null);
  };

  const newChat = () => {
    cancel();
    setTurns([]);
    setView({ type: "menu" });
    aiPanel.setTab("chat");
  };

  const insert = (turn: AssistantTurn) => {
    if (!parse && turn.kind === "note") return;
    const blockType: RichBlockType = turn.kind === "tasks" ? "todo" : "text";
    const content = turn.kind === "tasks" ? tasksToContent(turn.title, turn.tasks ?? []) : [{ type: "heading" as const, props: { level: 3 }, content: turn.title }, ...parse!(turn.text)];
    const box = placementBeside(api, conversation?.anchorIds ?? [], BLOCK_SIZE[blockType]);
    // Reviewed before anything is written: the review bar accepts or rejects it.
    getPendingChanges().propose(home.canvasId, {
      operationId: turn.provenance.operationId,
      title: turn.title,
      metadata: provenanceMetadata(turn.provenance),
      changes: [{ kind: "create_block", key: "reply", blockType, content, box }],
    });
  };

  const reveal = (id: string) => {
    const el = api.getSceneElements().find((e) => e.id === id) as NonDeletedExcalidrawElement | undefined;
    if (el) revealElement(api, el);
  };

  if (!panel.open || mode === "off") return null;

  void version; // lists below re-read the store on every conversation change
  const aiReady = primaryName !== null;
  const running = pending?.type === "running";
  const canAsk = aiReady && (hasSelection || scope !== "selection");
  // With nothing selected, the starter suggestions are about the whole canvas.
  const suggestionScope: AIScope = scope === "selection" && !hasSelection ? "canvas" : scope;
  const canvasConversations = store.list(home.workspaceId, home.canvasId);
  const selectionConversations = store.listFor(home.workspaceId, home.canvasId, selectedIds);
  const showsChatArea = view.type === "conversation" || (view.type === "menu" && pending);

  return (
    <aside
      className="acute-ai-panel"
      aria-label="Ask AI"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="acute-ai-panel__header">
        <div className="acute-ai-panel__tabs" role="tablist" aria-label="AI panel">
          <button type="button" role="tab" aria-selected={panel.tab === "chat"} onClick={() => aiPanel.setTab("chat")}>
            <SparkleIcon size={14} /> Chat
          </button>
          <button type="button" role="tab" aria-selected={panel.tab === "history"} onClick={() => aiPanel.openHistory()}>
            <HistoryIcon size={14} /> History
          </button>
          <button type="button" role="tab" aria-selected={panel.tab === "agent"} onClick={() => aiPanel.openAgentHistory()}>
            Agent log
          </button>
        </div>
        <span className="acute-ask-ai__header-actions">
          <button type="button" className="acute-ask-ai__close" aria-label="Close" onClick={close}>
            <CloseIcon size={14} />
          </button>
        </span>
      </header>

      {panel.tab === "chat" && (
        <div className="acute-ai-panel__body acute-ai-chat" role="tabpanel" aria-label="Chat">
          <div className="acute-ai-chat__scroll">
            {view.type === "menu" && !pending && (
              <div className="acute-ai-chat__home">
                <h2 className="acute-ai-chat__hello">Hello</h2>
                <p className="acute-ai-chat__prompt">How can I help you today?</p>
                {aiReady ? (
                  <div className="acute-ai-chat__chips" aria-label="Suggestions">
                    {suggestionsFor(items, suggestionScope).map((sug) => (
                      <button
                        key={sug.actionId}
                        type="button"
                        className="acute-ai-chip"
                        onClick={() => void ask({ action: SELECTION_ACTIONS.find((a) => a.id === sug.actionId)! }, null, suggestionScope)}
                      >
                        {sug.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="acute-ai-chat__notice">
                    Connect an AI provider to start.{" "}
                    <button type="button" className="acute-ask-ai__link" onClick={openAISettings}>
                      Open AI settings
                    </button>
                  </p>
                )}
                {hasSelection && selectionConversations.length > 0 && (
                  <button type="button" className="acute-ask-ai__link acute-ai-panel__earlier" onClick={() => aiPanel.openHistory("selection")}>
                    {selectionConversations.length} earlier conversation{selectionConversations.length === 1 ? "" : "s"} about this selection
                  </button>
                )}
              </div>
            )}

            {view.type === "related" && <RelatedView view={view} onReveal={reveal} onBack={() => setView({ type: "menu" })} />}

            {showsChatArea && (
              <>
                {view.type === "conversation" && conversation && (
                  <div className="acute-ai-panel__about" title={conversation.title}>
                    <span className="acute-ask-ai__title">{conversation.title}</span>
                  </div>
                )}
                <Transcript turns={turns} parse={parse} primaryName={primaryName} onInsert={insert} />
                {pending?.type === "running" && (
                  <>
                    <div className="acute-ask-ai__status" role="status">
                      <span className="acute-ask-ai__spinner" aria-hidden="true" />
                      <span>
                        {pending.label}
                        <span className="acute-ask-ai__hint">{scopeLabel(pending.scope)}</span>
                      </span>
                      <button type="button" className="acute-ask-ai__secondary" autoFocus onClick={cancel}>
                        Cancel
                      </button>
                    </div>
                    {pending.preview && <LivePreview text={pending.preview} content={pending.previewContent} />}
                  </>
                )}
                {pending?.type === "error" && (
                  <>
                    <p className="acute-ask-ai__error" role="alert">
                      {pending.message}
                    </p>
                    <div className="acute-ask-ai__buttons">
                      {pending.settings && (
                        <button type="button" className="acute-ask-ai__secondary" onClick={openAISettings}>
                          Open AI settings
                        </button>
                      )}
                      <button type="button" className="acute-ask-ai__primary" onClick={pending.retry}>
                        Try again
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSend={send}
            label={view.type === "conversation" ? "Ask a follow-up" : "Ask a question"}
            placeholder={
              !aiReady
                ? "Connect AI to ask questions"
                : running
                  ? "Waiting for the reply…"
                  : view.type === "conversation"
                    ? "Ask a follow-up, or type / for actions"
                    : canAsk
                      ? "Ask anything, or type / for actions"
                      : "Select something on the canvas first"
            }
            disabled={!aiReady || running || (view.type !== "conversation" && !canAsk)}
            coverage={!running && view.type === "conversation" && coverage?.conversationId === view.id ? coverage.coverage : undefined}
            onReveal={(id) => {
              const el = api.getSceneElements().find((e) => e.id === id);
              if (el) revealElement(api, el);
            }}
            sharing={
              view.type === "conversation" && conversation
                ? { kind: "about", label: conversation.anchorLabel }
                : { kind: "scope", label: sharingLabel(scope, items), scope, onScope: setScope }
            }
            actions={SELECTION_ACTIONS.filter((a) => a.available && ((a.id !== "update_from_content" && a.id !== "update_from_chats" && a.id !== "rearrange_layout" && a.id !== "revisualize_ai") || selectionSources.length > 0)).map((a) => {
              const used = effectiveScope(a, view.type === "conversation" ? (conversation?.scope ?? scope) : scope);
              const inConversation = view.type === "conversation";
              const needsSelection = !inConversation && !hasSelection && (used === "selection" || !a.task);
              return {
                action: a,
                hint: [used !== scope && !inConversation ? scopeLabel(used) : null, a.task || a.id === "update_from_chats" ? null : "Local"].filter(Boolean).join(" · ") || undefined,
                // Visualize has its own local-tier fallback (F31) and never strictly needs a connection, unlike every other task-based action.
                disabled: (!!a.task && a.id !== "visualize" && a.id !== "update_from_content" && !aiReady) || running || needsSelection,
              };
            })}
            onAction={(a) => {
              if (a.id === "visualize") {
                visualizeDialog.open(partialBlockSelection(api, items) ?? { text: sourceTextFor(items), label: anchorLabelFor(items, scope) });
                close();
                return;
              }
              if (a.id === "update_from_chats") {
                // The selection's notes, merged with ChatGPT chats the user pastes links for; conflicts come back as "Needs your call" choices.
                visualizeDialog.open({ text: "", label: "Update from chats", mergeSourceId: selectionSources[0]! });
                close();
                return;
              }
              if (a.id === "update_from_content") {
                // The latest accepted version's text, to edit or replace; the dialog reconciles it (F39).
                const sourceId = selectionSources[0]!;
                void loadLatest(getPersistence().contentSources, sourceId).then((latest) => {
                  if (!latest) api.setToast({ message: "The original content for this isn't on this device.", duration: 4000 });
                  else visualizeDialog.open({ text: latest.version.text, label: "Update", updateSourceId: sourceId });
                });
                close();
                return;
              }
              if (a.id === "revisualize_ai") {
                // Only the selected sections: their own text analysed again by AI, as a first run does. Everything else on the canvas is left alone.
                const sourceId = selectionSources[0]!;
                const scene = api.getSceneElements() as unknown as readonly SceneElement[];
                const sections = sectionsOfObjects(scene, sourceScope, (id) => getDocumentStore().get(id), sourceId);
                void loadLatest(getPersistence().contentSources, sourceId).then((latest) => {
                  if (!latest) api.setToast({ message: "The original content for this isn't on this device.", duration: 4000 });
                  else if (latest.source.tier !== "ai") api.setToast({ message: "This was made without AI, so there is nothing to re-run. Use “Re-arrange layout”.", duration: 5000 });
                  else if (!sections.length) api.setToast({ message: "Couldn't tell which section this is.", duration: 4000 });
                  else visualizeDialog.open({ text: latest.version.text, label: "Re-visualize", updateSourceId: sourceId, regenerate: sections, autoRun: { title: "Re-visualize with AI" } });
                });
                close();
                return;
              }
              if (a.id === "rearrange_layout") {
                // Only the selected sections (the frames of the selection, or the frames it sits in); every other section stays where it is.
                const sourceId = selectionSources[0]!;
                const scene = api.getSceneElements() as unknown as readonly SceneElement[];
                const frames = new Set(scene.flatMap((el) => (el.isDeleted || !sourceScope.has(el.id) ? [] : el.type === "frame" ? [el.id] : el.frameId ? [el.frameId] : [])));
                if (!frames.size) {
                  api.setToast({ message: "Select a section, or something inside one, to re-arrange it.", duration: 4000 });
                  close();
                  return;
                }
                void loadLatest(getPersistence().contentSources, sourceId).then((latest) => {
                  if (!latest) return api.setToast({ message: "The original content for this isn't on this device.", duration: 4000 });
                  const set = rearrangeSource({
                    plan: latest.version.plan,
                    existing: existingObjects(scene, (id) => getDocumentStore().get(id), sourceId),
                    scene,
                    operationId: newId("op"),
                    frames,
                  });
                  if (!set) return api.setToast({ message: "Nothing to re-arrange — the layout already matches.", duration: 4000 });
                  getPendingChanges().propose(home.canvasId, set);
                });
                close();
                return;
              }
              setDraft("");
              void ask({ action: a }, view.type === "conversation" && a.task ? (conversation ?? null) : null);
            }}
            onNewChat={newChat}
            status={
              view.type === "conversation" && conversation
                ? store.isSaved(conversation.id)
                  ? "Saved on this device"
                  : saving
                    ? "Saved on this device after the first reply"
                    : "Not saved: saving is off in AI settings"
                : undefined
            }
          />
        </div>
      )}

      {panel.tab === "agent" && <AgentHistoryTab api={api} home={home} />}

      {panel.tab === "history" && (
        <HistoryTab
          conversations={filter === "selection" ? selectionConversations : canvasConversations}
          allCount={canvasConversations.length}
          filter={filter}
          onFilter={setFilter}
          hasSelection={hasSelection}
          query={query}
          onQuery={setQuery}
          saving={saving}
          alive={new Set(api.getSceneElements().map((el) => el.id))}
          onOpen={(id) => void openConversation(id)}
          onExportAll={async () => {
            const data = await store.exportJson(home.workspaceId, home.canvasId);
            downloadText("ai-conversations.json", JSON.stringify(data, null, 2), "application/json");
          }}
          onDeleteAll={async () => {
            if (!window.confirm(`Delete all ${canvasConversations.length} AI conversations on this canvas? This can't be undone.`)) return;
            if (view.type === "conversation") newChat();
            await store.delete(canvasConversations.map((c) => c.id));
          }}
          onDelete={(id) => {
            if (view.type === "conversation" && view.id === id) setView({ type: "menu" });
            void store.delete([id]);
          }}
          onExport={(c) => void store.exportMarkdown(c.id).then((md) => downloadText(`${fileSlug(c.title, "conversation")}.md`, md, "text/markdown"))}
        />
      )}
    </aside>
  );
}

/** What the Sharing chip names: the selected object, "N objects", or the scope. */
function sharingLabel(scope: AIScope, items: readonly ContextItem[]): string {
  if (scope === "canvas") return "this canvas";
  if (scope === "workspace") return "this workspace";
  if (!items.length) return "nothing selected";
  return `“${anchorLabelFor(items, scope)}”`;
}

function hasSelectionNow(api: ExcalidrawImperativeAPI): boolean {
  return Object.keys(api.getAppState().selectedElementIds).length > 0;
}

function HistoryTab({
  conversations,
  allCount,
  filter,
  onFilter,
  hasSelection,
  query,
  onQuery,
  saving,
  alive,
  onOpen,
  onExport,
  onDelete,
  onExportAll,
  onDeleteAll,
}: {
  conversations: AIConversation[];
  allCount: number;
  filter: HistoryFilter;
  onFilter: (f: HistoryFilter) => void;
  hasSelection: boolean;
  query: string;
  onQuery: (q: string) => void;
  saving: boolean;
  alive: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onExport: (c: AIConversation) => void;
  onDelete: (id: string) => void;
  onExportAll: () => void;
  onDeleteAll: () => void;
}) {
  const q = query.trim().toLowerCase();
  const shown = q ? conversations.filter((c) => c.title.toLowerCase().includes(q) || c.anchorLabel.toLowerCase().includes(q)) : conversations;
  return (
    <div className="acute-ai-panel__body" role="tabpanel" aria-label="History">
      <div className="acute-ask-ai__scope" role="radiogroup" aria-label="Show conversations">
        {(
          [
            ["selection", "Selected"],
            ["all", "All on this canvas"],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className={filter === id ? "active" : ""}>
            <input type="radio" name="acute-ai-history-filter" checked={filter === id} onChange={() => onFilter(id)} />
            {label}
          </label>
        ))}
      </div>
      <input className="acute-ask-ai__search" type="search" placeholder="Search conversations…" aria-label="Search conversations" value={query} onChange={(e) => onQuery(e.target.value)} />
      <div className="acute-ai-panel__list">
        {filter === "selection" && !hasSelection ? (
          <p className="acute-ask-ai__empty">Select an object to see its conversations.</p>
        ) : conversations.length ? (
          <ul className="acute-conv-list">
            {shown.map((c) => (
              <li key={c.id}>
                <ConversationRow conversation={c} onOpen={onOpen} anchorGone={!c.anchorIds.some((id) => alive.has(id))} />
                <span className="acute-conv-list__actions">
                  <button type="button" aria-label={`Export "${c.title}"`} title="Export as Markdown" onClick={() => onExport(c)}>
                    <DownloadIcon size={14} />
                  </button>
                  <button type="button" aria-label={`Delete "${c.title}"`} title="Delete" onClick={() => onDelete(c.id)}>
                    <TrashIcon size={14} />
                  </button>
                </span>
              </li>
            ))}
            {!shown.length && <li className="acute-ask-ai__empty">No matching conversations</li>}
          </ul>
        ) : (
          <p className="acute-ask-ai__empty">
            {filter === "selection" ? "No conversations about this selection yet." : "No AI conversations on this canvas yet. Select a block and use ✨ Ask AI to start one."}
          </p>
        )}
      </div>
      <footer className="acute-ai-history__footer">
        <span>
          {saving ? "Saved on this device only." : "Saving is off. "}
          {!saving && (
            <button type="button" className="acute-ask-ai__link" onClick={openAISettings}>
              Turn on
            </button>
          )}
        </span>
        {allCount > 0 && (
          <span className="acute-ai-history__footer-actions">
            <button type="button" className="acute-ask-ai__link" onClick={onExportAll}>
              Export all
            </button>
            <button type="button" className="acute-ask-ai__link acute-ask-ai__link--danger" onClick={onDeleteAll}>
              Delete all
            </button>
          </span>
        )}
      </footer>
    </div>
  );
}

interface ComposerAction {
  action: SelectionAction;
  hint?: string;
  disabled: boolean;
}

type Sharing = { kind: "about"; label: string } | { kind: "scope"; label: string; scope: AIScope; onScope: (s: AIScope) => void };

/**
 * The chat composer, pinned to the bottom of the panel: what's being shared
 * (click to change the scope), the text box ("/" opens the actions), and a
 * row with new chat, actions, the model picker and send.
 */
function ChatComposer({
  value,
  onChange,
  onSend,
  label,
  placeholder,
  disabled,
  sharing,
  actions,
  onAction,
  onNewChat,
  status,
  coverage,
  onReveal,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  label: string;
  placeholder: string;
  disabled: boolean;
  sharing: Sharing;
  actions: ComposerAction[];
  onAction: (a: SelectionAction) => void;
  onNewChat: () => void;
  status?: string;
  /** What the latest reply's context covered, when known. */
  coverage?: ContextCoverage;
  /** Shows an object on the canvas (left-out objects that are on this canvas). */
  onReveal: (id: string) => void;
}) {
  const [menu, setMenu] = useState<"actions" | "scope" | null>(null);
  const slash = value.startsWith("/");
  const filter = slash ? value.slice(1).trim().toLowerCase() : "";
  const shown = actions.filter((a) => !filter || a.action.label.toLowerCase().includes(filter));
  const actionsOpen = menu === "actions" || (slash && !disabled);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menu]);

  const pick = (a: ComposerAction) => {
    if (a.disabled) return;
    setMenu(null);
    onAction(a.action);
  };

  return (
    <div
      className="acute-ai-composer"
      ref={rootRef}
      onKeyDown={(e) => {
        // Esc closes an open menu first; only then does it close the panel.
        if (e.key === "Escape" && menu) {
          e.stopPropagation();
          setMenu(null);
        }
      }}
    >
      {actionsOpen && (
        <div role="menu" aria-label="AI actions" className="acute-ai-popover acute-ask-ai__actions">
          {shown.length ? (
            shown.map((a) => (
              <button key={a.action.id} type="button" role="menuitem" disabled={a.disabled} onClick={() => pick(a)}>
                {a.action.label}
                {a.hint && <span className="acute-ask-ai__hint">{a.hint}</span>}
              </button>
            ))
          ) : (
            <p className="acute-ask-ai__empty">No matching actions</p>
          )}
        </div>
      )}
      {menu === "scope" && sharing.kind === "scope" && (
        <div className="acute-ai-popover acute-ai-popover--scope" role="radiogroup" aria-label="AI scope">
          {SCOPES.map((s) => (
            <label key={s.id} className={sharing.scope === s.id ? "active" : ""}>
              <input
                type="radio"
                name="acute-ai-scope"
                checked={sharing.scope === s.id}
                onChange={() => {
                  sharing.onScope(s.id);
                  setMenu(null);
                }}
              />
              {s.label}
            </label>
          ))}
        </div>
      )}

      {sharing.kind === "scope" ? (
        <button
          type="button"
          className="acute-ai-sharing"
          aria-haspopup="true"
          aria-expanded={menu === "scope"}
          title="What this chat can see. Click to change."
          onClick={() => setMenu(menu === "scope" ? null : "scope")}
        >
          <SparkleIcon size={13} />
          <span className="acute-ai-sharing__text">Sharing {sharing.label}</span>
          <ChevronDownIcon size={13} />
        </button>
      ) : (
        <div className="acute-ai-sharing acute-ai-sharing--static" title="What this conversation is about">
          <SparkleIcon size={13} />
          <span className="acute-ai-sharing__text">About “{sharing.label}”</span>
        </div>
      )}

      <form
        className="acute-ai-composer__box"
        onSubmit={(e) => {
          e.preventDefault();
          if (slash) {
            const first = shown.find((a) => !a.disabled);
            if (first) pick(first);
          } else onSend();
        }}
      >
        <textarea
          rows={2}
          value={value}
          placeholder={placeholder}
          aria-label={label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && (slash || menu)) {
              e.stopPropagation();
              setMenu(null);
              if (slash) onChange("");
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="acute-ai-composer__row">
          <button type="button" className="acute-ai-composer__icon" aria-label="New conversation" title="New conversation" onClick={onNewChat}>
            <PlusIcon size={17} />
          </button>
          <button
            type="button"
            className="acute-ai-composer__icon"
            aria-label="Actions"
            title="Actions (or type /)"
            aria-expanded={actionsOpen}
            onClick={() => setMenu(menu === "actions" ? null : "actions")}
          >
            <SlidersIcon size={17} />
          </button>
          <ModelPicker />
          <button type="submit" className="acute-ai-composer__send" aria-label="Send" title="Send (Enter)" disabled={disabled || !value.trim() || slash}>
            <SendIcon size={15} />
          </button>
        </div>
      </form>
      {status && <p className="acute-ai-composer__status">{status}</p>}
      {coverage && <CoverageNote coverage={coverage} onReveal={onReveal} />}
    </div>
  );
}

const thousands = (n: number) => n.toLocaleString("en-US");

/**
 * What the last reply's AI saw (F18 → CAP-01): how much of the context
 * budget it used and, when the budget ran out, which objects were shortened
 * or left out. Collapsed to one line; nothing to open when everything fit.
 */
function CoverageNote({ coverage, onReveal }: { coverage: ContextCoverage; onReveal: (id: string) => void }) {
  const left = coverage.omitted.length + coverage.omittedMore;
  const used = `${thousands(coverage.chars)} of ${thousands(coverage.budget)} characters`;
  if (!left && !coverage.trimmed.length) {
    return <p className="acute-ai-coverage acute-ai-coverage--plain">The AI saw everything in scope ({used}).</p>;
  }
  const parts = [coverage.trimmed.length ? `${coverage.trimmed.length} shortened` : null, left ? `${left} left out` : null].filter(Boolean).join(" · ");
  return (
    <details className="acute-ai-coverage">
      <summary>
        Context limit reached: {parts} <span className="acute-ai-coverage__used">({used})</span>
      </summary>
      {coverage.trimmed.length > 0 && (
        <>
          <div className="acute-ask-ai__section-title">Shortened to fit</div>
          <CoverageList notes={coverage.trimmed} onReveal={onReveal} />
        </>
      )}
      {left > 0 && (
        <>
          <div className="acute-ask-ai__section-title">Left out</div>
          <CoverageList notes={coverage.omitted} onReveal={onReveal} />
          {coverage.omittedMore > 0 && <p className="acute-ai-coverage__more">…and {coverage.omittedMore} more.</p>}
        </>
      )}
      <p className="acute-ai-coverage__hint">Select what matters and ask again to put it first.</p>
    </details>
  );
}

function CoverageList({ notes, onReveal }: { notes: ContextCoverage["omitted"]; onReveal: (id: string) => void }) {
  return (
    <ul className="acute-ai-coverage__list">
      {notes.map((n) => (
        <li key={n.id}>
          {n.onCanvas ? (
            <button type="button" className="acute-ask-ai__link" title="Show on the canvas" onClick={() => onReveal(n.id)}>
              {n.label}
            </button>
          ) : (
            <span title="On another canvas">{n.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Which connection and model the chat uses. Lists models for connections
 * that can list them truthfully, and switches connection when there are
 * several (switching saves it as the primary).
 */
function ModelPicker() {
  const [open, setOpen] = useState(false);
  const [configs, setConfigs] = useState<AIProviderConfig[]>([]);
  const [models, setModels] = useState<AIModel[] | null>(null);
  const [tick, setTick] = useState(0);
  const primaryId = getPrimaryId();
  const descriptor = primaryId ? getDescriptor(primaryId) : undefined;
  const config = configs.find((c) => c.providerId === primaryId);

  useEffect(() => {
    let cancelled = false;
    void connections.listConfigs().then((list) => !cancelled && setConfigs(list));
    return () => {
      cancelled = true;
    };
  }, [open, tick]);

  useEffect(() => {
    if (!open || !primaryId || !descriptor?.listsModels) return;
    let cancelled = false;
    connections.listModels(primaryId).then(
      (list) => !cancelled && setModels(list),
      () => !cancelled && setModels([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open, primaryId, descriptor?.listsModels]);

  if (!primaryId || !descriptor) return <span className="acute-ai-model acute-ai-model--none">No model</span>;
  const modelName = config?.model ? (models?.find((m) => m.id === config.model)?.name ?? config.model) : "Default model";

  return (
    <div className="acute-ai-model-wrap">
      <button
        type="button"
        className="acute-ai-model"
        aria-label={`Model: ${descriptor.name} · ${modelName}`}
        title={`${descriptor.name} · ${modelName}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="acute-ai-model__text">{modelName}</span>
        <ChevronDownIcon size={13} />
      </button>
      {open && (
        <div className="acute-ai-popover acute-ai-popover--model" role="menu" aria-label="Model">
          <div className="acute-ask-ai__section-title">{descriptor.name}</div>
          {descriptor.listsModels ? (
            models === null ? (
              <p className="acute-ask-ai__empty">Loading models…</p>
            ) : (
              [{ id: "", name: "Default model" }, ...models].map((m) => (
                <button
                  key={m.id || "default"}
                  type="button"
                  role="menuitemradio"
                  aria-checked={(config?.model ?? "") === m.id}
                  onClick={() => {
                    setOpen(false);
                    void connections.updateModel(primaryId, m.id || undefined).then(() => setTick((t) => t + 1));
                  }}
                >
                  {m.name}
                </button>
              ))
            )
          ) : (
            <p className="acute-ask-ai__empty">{config?.model ?? "Model set in AI settings"}</p>
          )}
          {configs.length > 1 && (
            <>
              <div className="acute-ask-ai__section-title">Connection</div>
              {configs.map((c) => (
                <button
                  key={c.providerId}
                  type="button"
                  role="menuitemradio"
                  aria-checked={c.providerId === primaryId}
                  onClick={() => {
                    setOpen(false);
                    setModels(null);
                    void connections.setPrimary(c.providerId).then(() => setTick((t) => t + 1));
                  }}
                >
                  {getDescriptor(c.providerId)?.name ?? c.providerId}
                </button>
              ))}
            </>
          )}
          <button type="button" role="menuitem" className="acute-ai-popover__footer" onClick={() => {
              setOpen(false);
              openAISettings();
            }}>
            AI settings…
          </button>
        </div>
      )}
    </div>
  );
}

/** One conversation: title, what it's about, reply count, age. */
function ConversationRow({ conversation: c, onOpen, anchorGone }: { conversation: AIConversation; onOpen: (id: string) => void; anchorGone?: boolean }) {
  const replies = Math.floor(c.turnCount / 2);
  return (
    <button type="button" className="acute-conv-row" onClick={() => onOpen(c.id)} title={c.title}>
      <span className="acute-conv-row__title">{c.title}</span>
      <span className="acute-conv-row__meta">
        {c.anchorLabel}
        {anchorGone ? " · deleted object" : ""} · {replies} {replies === 1 ? "reply" : "replies"}
      </span>
      <span className="acute-conv-row__age">{formatAgo(c.updatedAt)}</span>
    </button>
  );
}

/** Past turns of the open conversation; each reply can be inserted on the canvas. */
function Transcript({
  turns,
  parse,
  primaryName,
  onInsert,
}: {
  turns: readonly AITurn[];
  parse: Parse | null;
  primaryName: string | null;
  onInsert: (turn: AssistantTurn) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [turns.length]);
  if (!turns.length) return null;
  return (
    <div ref={ref} className="acute-ask-ai__transcript">
      {turns.map((t) =>
        t.role === "user" ? (
          <div key={t.seq} className="acute-ask-ai__you">
            {t.action ? <span className="acute-ask-ai__chip">{t.text}</span> : t.text}
            <span className="acute-ask-ai__hint">{scopeLabel(t.scope)}</span>
          </div>
        ) : (
          <div key={t.seq} className="acute-ask-ai__reply">
            <div className="acute-ask-ai__subtitle">{t.title}</div>
            <div className="acute-ask-ai__result">
              <BlockPreview content={t.kind === "tasks" ? tasksToContent(t.title, t.tasks ?? []).slice(1) : parse ? parse(t.text) : [{ type: "paragraph", content: t.text }]} />
            </div>
            {t.provenance.role === "fallback" && (
              <p className="acute-ask-ai__notice">
                Used {getDescriptor(t.provenance.providerId)?.name ?? t.provenance.providerId} (fallback) — {primaryName ?? "your primary connection"} was unavailable.
              </p>
            )}
            <div className="acute-ask-ai__buttons">
              <button type="button" className="acute-ask-ai__primary" onClick={() => onInsert(t)}>
                {t.kind === "tasks" ? "Insert as todo list" : "Insert on canvas"}
              </button>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * The streaming reply, formatted as it arrives (raw text until the parser has
 * loaded). Follows the end of the text unless the user scrolls up.
 */
function LivePreview({ text, content }: { text: string; content: RichContent | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [text, content]);
  return (
    <div
      ref={ref}
      className={content ? "acute-ask-ai__stream acute-ask-ai__stream--formatted" : "acute-ask-ai__stream"}
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        followRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      }}
    >
      {content ? <BlockPreview content={content} /> : text}
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  text: "Text",
  todo: "Todo",
  table: "Table",
  code: "Code",
  page: "Page",
  shape: "Shape",
  note: "Text",
};

function RelatedView({
  view,
  onReveal,
  onBack,
}: {
  view: Extract<ChatView, { type: "related" }>;
  onReveal: (id: string) => void;
  onBack: () => void;
}) {
  const { result } = view;
  return (
    <>
      <div className="acute-ask-ai__subtitle">
        {result.matches.length ? `${result.matches.length} related item${result.matches.length === 1 ? "" : "s"}` : "No related items found"}
        <span className="acute-ask-ai__hint">{scopeLabel(view.scope)}</span>
      </div>
      {result.matches.length > 0 && (
        <ul className="acute-ask-ai__related">
          {result.matches.map((m) => (
            <li key={m.item.id}>
              <button type="button" disabled={!m.item.onCanvas} onClick={() => onReveal(m.item.id)} title={m.item.onCanvas ? "Show on canvas" : "On another canvas"}>
                <span className="acute-ask-ai__kind">{KIND_LABELS[m.item.kind]}</span>
                <span className="acute-ask-ai__snippet">{m.item.title ?? m.item.text.replace(/\s+/g, " ").slice(0, 80)}</span>
                <span className="acute-ask-ai__why">
                  {[m.connected ? "connected" : null, m.terms.length ? m.terms.join(", ") : null, m.item.onCanvas ? null : "other canvas"].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="acute-ask-ai__buttons">
        <button type="button" className="acute-ask-ai__secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}
