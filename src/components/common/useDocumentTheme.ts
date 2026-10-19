"use client";

import { useSyncExternalStore } from "react";

/** The app theme the canvas applies to `<html data-theme>`, for UI outside the canvas. */
export function useDocumentTheme(): "light" | "dark" {
  return useSyncExternalStore(
    (cb) => {
      const observer = new MutationObserver(cb);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => observer.disconnect();
    },
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    () => "light",
  );
}
