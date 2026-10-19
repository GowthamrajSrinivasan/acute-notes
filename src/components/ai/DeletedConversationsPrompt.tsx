"use client";

/**
 * When an object that AI conversations were about is deleted, asks whether
 * to delete those conversations too (F40). Non-blocking: the deletion itself
 * already happened; "Keep" leaves them in history (marked "deleted object"),
 * and undoing the deletion dismisses the question.
 *
 * Detection stays off the interaction path: scene changes only mark the check
 * dirty, and the check runs at most every CHECK_INTERVAL_MS, only when this
 * canvas has conversations.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getConversationStore } from "@/ai/conversations/conversationStore";
import type { AIConversation } from "@/ai/conversations/types";
import type { DocumentHome } from "@/domain/types";

const CHECK_INTERVAL_MS = 500;

export function DeletedConversationsPrompt({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const [orphans, setOrphans] = useState<AIConversation[]>([]);
  /** Anchored objects seen alive — only their deletion prompts (not objects deleted before opening). */
  const aliveRef = useRef(new Set<string>());

  useEffect(() => {
    const store = getConversationStore();
    let timer = 0;
    let dirty = true;

    const check = () => {
      timer = 0;
      if (!dirty) return;
      dirty = false;
      const anchored = store.anchoredIds(home.workspaceId, home.canvasId);
      if (!anchored.size) return;
      const deleted = new Set<string>();
      const present = new Set<string>();
      for (const el of api.getSceneElementsIncludingDeleted()) {
        if (!anchored.has(el.id)) continue;
        if (el.isDeleted) deleted.add(el.id);
        else present.add(el.id);
      }
      for (const id of anchored) if (!present.has(id)) deleted.add(id);

      const newlyDeleted = [...deleted].filter((id) => aliveRef.current.has(id));
      for (const id of present) aliveRef.current.add(id);
      for (const id of newlyDeleted) aliveRef.current.delete(id);

      setOrphans((current) => {
        // Restored (undo): drop conversations whose objects are back.
        const still = current.filter((c) => c.anchorIds.every((id) => deleted.has(id)) && store.get(c.id));
        if (!newlyDeleted.length) return still.length === current.length ? current : still;
        const fresh = store.orphanedBy(home.workspaceId, home.canvasId, deleted).filter(
          (c) => c.anchorIds.some((id) => newlyDeleted.includes(id)) && !still.some((s) => s.id === c.id),
        );
        return fresh.length ? [...still, ...fresh] : still;
      });
    };

    const schedule = () => {
      dirty = true;
      timer ||= window.setTimeout(check, CHECK_INTERVAL_MS);
    };
    const unsubscribeScene = api.onChange(schedule);
    const unsubscribeStore = store.subscribe(schedule);
    void store.load(home.workspaceId).then(schedule);
    return () => {
      clearTimeout(timer);
      unsubscribeScene();
      unsubscribeStore();
    };
  }, [api, home]);

  if (!orphans.length) return null;
  const count = orphans.length;

  return createPortal(
    <div className="acute-ai-orphans" role="alert">
      <span>
        {count === 1 ? "The deleted object had an AI conversation" : `The deleted objects had ${count} AI conversations`}
        {count === 1 ? ` (“${orphans[0]!.title}”)` : ""}. Delete {count === 1 ? "it" : "them"} too?
      </span>
      <span className="acute-ai-orphans__actions">
        <button type="button" className="acute-ask-ai__secondary" onClick={() => setOrphans([])}>
          Keep
        </button>
        <button
          type="button"
          className="acute-ask-ai__primary acute-ask-ai__primary--danger"
          onClick={() => {
            const ids = orphans.map((c) => c.id);
            setOrphans([]);
            void getConversationStore().delete(ids);
          }}
        >
          Delete {count === 1 ? "conversation" : "conversations"}
        </button>
      </span>
    </div>,
    document.body,
  );
}
