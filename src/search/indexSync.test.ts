/**
 * Stage 4b — the index invariant with the real index and scheduler (intelligent-update-engine-plan §12.9 A): the index
 * reflects the latest committed scene — edits, deletions, undo and redo alike — and a failed unit is never recorded as
 * indexed (it stays due, and the failure is reported). A change set under review lives outside the scene, so it can't
 * reach the index.
 */
import { describe, expect, it } from "vitest";
import { PendingChanges } from "@/ai/changes/pendingChanges";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { IndexScheduler, type SchedulerHost } from "./indexScheduler";
import { block, doc, note, para } from "./testFixtures";
import { WorkspaceIndex } from "./workspaceIndex";

const host: SchedulerHost = { now: () => 0, setTimer: () => 0, clearTimer: () => undefined, requestIdle: () => 0, cancelIdle: () => undefined };

function world() {
  const index = new WorkspaceIndex("ws");
  const scheduler = new IndexScheduler(host);
  const errors: string[] = [];
  scheduler.onError = (key, err) => errors.push(`${key}: ${(err as Error).message}`);
  const docs = new Map<string, DocumentRecord>();
  let scene: SceneElement[] = [];
  const getDocument = (id: string) => docs.get(id);
  let failNext = 0;
  const commit = () => {
    scheduler.markDirty("scene:cv", () =>
      index.planScene("cv", scene, getDocument).map((u) => () => {
        if (failNext > 0) {
          failNext--;
          throw new Error("Simulated index failure");
        }
        u();
      }),
    );
    scheduler.flush();
  };
  const verify = () => index.verifyScene("cv", scene, getDocument);
  const texts = () => index.objects({ canvasId: "cv" }).map((o) => o.text).sort();
  return {
    index,
    docs,
    errors,
    commit,
    verify,
    texts,
    set: (els: SceneElement[]) => (scene = els),
    get scene() {
      return scene;
    },
    failNext: (n: number) => (failNext = n),
  };
}

const card = (id: string, text: string, version = 1) => ({ el: block(id, `doc_${id}`, { version } as Partial<SceneElement>), doc: doc(`doc_${id}`, para(text)) });

describe("Stage 4b — the index reflects the committed scene", () => {
  it("accepted content, a manual edit, a deletion, undo and redo: verified in sync after each", () => {
    const w = world();
    const a = card("a", "Retries happen five times.");
    const b = card("b", "Timeouts last ten seconds.");
    w.docs.set(a.doc.id, a.doc).set(b.doc.id, b.doc);
    w.set([a.el, b.el]);
    w.commit(); // accepted
    expect(w.verify()).toEqual({ stale: [], extra: [] });
    expect(w.texts()).toEqual(["Retries happen five times.", "Timeouts last ten seconds."]);

    // A manual edit: the document changes (a new record), the element is re-stamped.
    const edited = doc(a.doc.id, para("Retries happen three times."));
    w.docs.set(edited.id, edited);
    expect(w.verify().stale).toEqual(["a"]); // known out of date until synced
    w.commit();
    expect(w.verify()).toEqual({ stale: [], extra: [] });
    expect(w.texts()).toContain("Retries happen three times.");

    // A deletion.
    w.set([a.el]);
    expect(w.verify().extra).toEqual(["b"]);
    w.commit();
    expect(w.verify()).toEqual({ stale: [], extra: [] });
    expect(w.texts()).toEqual(["Retries happen three times."]);

    // Undo (b comes back with its document) and redo (gone again).
    w.set([a.el, { ...b.el, version: 3 } as SceneElement]);
    w.commit();
    expect(w.texts()).toEqual(["Retries happen three times.", "Timeouts last ten seconds."]);
    expect(w.verify()).toEqual({ stale: [], extra: [] });
    w.set([a.el]);
    w.commit();
    expect(w.texts()).toEqual(["Retries happen three times."]);
    expect(w.verify()).toEqual({ stale: [], extra: [] });
  });

  it("a failed work unit is reported and never recorded as indexed: the object stays due and the next sync fixes it", () => {
    const w = world();
    const a = card("a", "Retries happen five times.");
    w.docs.set(a.doc.id, a.doc);
    w.set([a.el]);
    w.commit();
    const edited = doc(a.doc.id, para("Retries happen three times."));
    w.docs.set(edited.id, edited);
    w.failNext(1);
    w.commit();
    expect(w.errors).toEqual(["scene:cv: Simulated index failure"]);
    // Before Stage 4b the stamp was written first, so this read as in sync while the old text stayed indexed.
    expect(w.verify().stale).toEqual(["a"]);
    expect(w.texts()).toEqual(["Retries happen five times."]);
    w.commit(); // recovery
    expect(w.verify()).toEqual({ stale: [], extra: [] });
    expect(w.texts()).toEqual(["Retries happen three times."]);
  });

  it("a change set under review never reaches the index; only what is committed to the scene does", () => {
    const w = world();
    const a = card("a", "Retries happen five times.");
    w.docs.set(a.doc.id, a.doc);
    w.set([a.el, note("n", "A free note")]);
    w.commit();
    const before = w.texts();
    const pending = new PendingChanges();
    pending.propose("cv", { operationId: "op", title: "t", metadata: { createdBy: "ai" }, changes: [{ kind: "create_block", key: "k", blockType: "text", content: para("Proposed only."), box: { x: 0, y: 0, width: 1, height: 1 } }] });
    w.commit(); // the indexer runs again: nothing new in the scene
    expect(w.texts()).toEqual(before);
    pending.settle("cv", "op"); // rejected
    w.commit();
    expect(w.texts()).toEqual(before);
    expect(w.verify()).toEqual({ stale: [], extra: [] });
  });

  it("a deleted card's document, kept for undo, is not found once the card is gone; undo makes it findable again", () => {
    const index = new WorkspaceIndex("ws");
    const a = card("a", "Retries happen five times.");
    const other = doc("doc_elsewhere", para("Retries elsewhere, on another canvas."), { canvasId: "cv2" });
    const get = (id: string) => (id === a.doc.id ? a.doc : undefined);
    index.syncDocuments([a.doc, other]); // the live indexer indexes blocks as documents too
    index.syncScene("cv", [a.el], get);
    const found = () => index.query({ text: "retries", mode: "any" }).hits.map((h) => h.id).sort();
    expect(found()).toEqual(["a", "doc_elsewhere"]);
    index.syncScene("cv", [], get); // deleted; its document stays in the store for undo
    expect(found()).toEqual(["doc_elsewhere"]); // a block of another canvas is still found
    expect(index.objects({ canvasId: "cv" })).toEqual([]);
    index.syncScene("cv", [{ ...a.el, version: 2 } as SceneElement], get); // undo
    expect(found()).toEqual(["a", "doc_elsewhere"]);
  });
});
