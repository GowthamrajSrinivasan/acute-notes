"use client";

import { useState, type ReactNode } from "react";
import { BundleError } from "@/portability/bundleError";

/**
 * Runs a user action (export, import…) with a busy flag and an error dialog.
 * A rejected file (`BundleError`) is an expected outcome shown as-is; anything
 * else is logged and shown as a generic failure.
 */
export function useActionRunner(): {
  run: (action: () => Promise<void>, failure: string) => void;
  busy: boolean;
  errorDialog: ReactNode;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const run = (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    action()
      .catch((err: unknown) => {
        if (!(err instanceof BundleError)) console.error(`[acute-notes] ${failure}`, err);
        setError({
          title: failure,
          message: err instanceof BundleError ? err.message : "Something went wrong. Your data was not changed.",
        });
      })
      .finally(() => setBusy(false));
  };

  const errorDialog = error && (
    <div className="acute-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && setError(null)}>
      <div className="acute-dialog" role="alertdialog" aria-labelledby="acute-error-title">
        <h2 id="acute-error-title">{error.title}</h2>
        <p className="acute-dialog__error">{error.message}</p>
        <div className="acute-dialog__actions">
          <button type="button" data-primary autoFocus onClick={() => setError(null)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );

  return { run, busy, errorDialog };
}
