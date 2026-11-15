"use client";

/** The canvas's distil objects (`knowledgeObjectsOf`), re-read when the scene changes (at most once per frame) or a review changed. */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState } from "react";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getDocumentStore } from "@/state/documents";
import { knowledgeObjectsOf, type KnowledgeObject } from "./knowledgeObjects";

const getDocument = (id: string) => getDocumentStore().get(id);

export function useSceneVersion(api: ExcalidrawImperativeAPI): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let frame = 0;
    let last: readonly unknown[] | null = null;
    const off = api.onChange((elements) => {
      if (elements === last) return;
      last = elements;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setVersion((v) => v + 1);
        });
    });
    return () => {
      off();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api]);
  return version;
}

export function useKnowledgeObjects(api: ExcalidrawImperativeAPI, revision: number): { objects: KnowledgeObject[]; sceneVersion: number } {
  const sceneVersion = useSceneVersion(api);
  const objects = useMemo(() => {
    void sceneVersion;
    void revision;
    return knowledgeObjectsOf(api.getSceneElements() as unknown as readonly SceneElement[], getDocument);
  }, [api, sceneVersion, revision]);
  return { objects, sceneVersion };
}
