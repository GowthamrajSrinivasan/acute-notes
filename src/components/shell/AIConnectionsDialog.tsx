"use client";

import { useCallback, useEffect, useState } from "react";
import { CloseIcon, EyeIcon, EyeOffIcon } from "@/components/common/icons";
import { setAIMode } from "@/ai/aiMode";
import * as connections from "@/ai/connections";
import { getConversationStore } from "@/ai/conversations/conversationStore";
import { aiMarkers, TIMED_MARKER_MS } from "@/components/ai/aiMarkersStore";
import { useAIMode, useSaveConversations } from "@/components/ai/askAI";
import type { SecretStorageMode } from "@/ai/credentials/credentialStore";
import { AI_PROVIDER_DESCRIPTORS, type AIConnectionAccessType, type AIProviderDescriptor } from "@/ai/providers/registry";
import type { AIModel, AIProviderConfig } from "@/ai/types";
import { describeUsage, getAIUsageRepository, thisMonth, type AIUsageSummary } from "@/ai/usage/usageRepository";
import { setUiPref, useUiPref, type AIChangeMarkers } from "@/state/uiPrefs";
import { CleanupSettings } from "./CleanupSettings";
import { ResponseStyleSettings } from "./ResponseStyleSettings";

const GROUPS: readonly { type: AIConnectionAccessType; label: string; hint: string }[] = [
  { type: "subscription", label: "Subscription", hint: "Uses a plan you already pay for" },
  { type: "api_key", label: "Your API key", hint: "Billed directly by the provider" },
  { type: "local", label: "Local", hint: "No cloud AI charges" },
];

type TestResult = { ok: boolean; message?: string };

const MARKER_OPTIONS: readonly { value: AIChangeMarkers; label: string }[] = [
  { value: "timed", label: `${TIMED_MARKER_MS / 1000} seconds` },
  { value: "until_clicked", label: "Until clicked" },
  { value: "off", label: "Off" },
];

/**
 * AI Providers settings (F27, PRD §6.6) — built entirely from
 * `AI_PROVIDER_DESCRIPTORS`; no connection name is hard-coded here. Reachable
 * from the app's `⋮` menu (`TopHeader.tsx`).
 */
export function AIConnectionsDialog({ onClose }: { onClose: () => void }) {
  const [configs, setConfigs] = useState<AIProviderConfig[] | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [primaryAuto, setPrimaryAuto] = useState(false);
  const [fallbackId, setFallbackId] = useState<string | null>(null);
  const [decisionConn, setDecisionConn] = useState("");
  const [decisionModel, setDecisionModel] = useState("");
  const [typedConn, setTypedConn] = useState("");
  const [typedModel, setTypedModel] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: "test" | "other" } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const aiMode = useAIMode();
  const saveConversations = useSaveConversations();
  const markers = useUiPref("aiChangeMarkers");

  const refresh = useCallback(async () => {
    setConfigs(await connections.listConfigs());
    setPrimaryId(connections.getPrimaryId());
    setPrimaryAuto(connections.isPrimaryAutomatic());
    setFallbackId(connections.getFallbackId());
    const decision = await connections.getDecisionSelection();
    setDecisionConn(decision?.connectionId ?? "");
    setDecisionModel(decision?.model ?? "");
    const typed = await connections.getTypedDecisionSelection();
    setTypedConn(typed?.connectionId ?? "");
    setTypedModel(typed?.model ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void connections.getDecisionSelection().then((decision) => {
      if (cancelled) return;
      setDecisionConn(decision?.connectionId ?? "");
      setDecisionModel(decision?.model ?? "");
    });
    void connections.getTypedDecisionSelection().then((typed) => {
      if (cancelled) return;
      setTypedConn(typed?.connectionId ?? "");
      setTypedModel(typed?.model ?? "");
    });
    connections.listConfigs().then((list) => {
      if (cancelled) return;
      setConfigs(list);
      setPrimaryId(connections.getPrimaryId());
      setPrimaryAuto(connections.isPrimaryAutomatic());
      setFallbackId(connections.getFallbackId());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes the innermost dialog wherever focus is (the backdrop may not hold it).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (connectingId) setConnectingId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connectingId, onClose]);

  if (!configs) return null;

  const configById = new Map(configs.map((c) => [c.providerId, c]));

  const run = (id: string, action: () => Promise<void>) => {
    setBusy({ id, action: "other" });
    action()
      .then(refresh)
      .catch((err: unknown) => console.error("[acute-notes] AI connection action failed", err))
      .finally(() => setBusy(null));
  };

  const test = (id: string) => {
    setBusy({ id, action: "test" });
    setTestResults((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
    connections
      .testConnection(id)
      .then((result) => setTestResults((r) => ({ ...r, [id]: result })))
      .finally(() => setBusy(null));
  };

  const fallbackOptions = configs.filter((c) => c.providerId !== primaryId);
  // Connections whose key also opens a dedicated typed decision model (for example Jev on OpenRouter).
  const typedOptions = connections.typedDecisionOptions().filter((o) => configs.some((c) => c.providerId === o.connectionId));
  const typedOption = typedOptions.find((o) => o.connectionId === typedConn);

  return (
    <div className="acute-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="acute-dialog acute-ai-settings" role="dialog" aria-modal="true" aria-labelledby="acute-ai-settings-title">
        <header className="acute-ai-settings__header">
          <div>
            <h2 id="acute-ai-settings-title" className="acute-ai-settings__title">
              AI Providers
            </h2>
            <p className="acute-ai-settings__subtitle">
              Use the AI you already have — a subscription, your own API key, or a local model. Keys are encrypted on this device.
            </p>
          </div>
          <button type="button" className="acute-ai-settings__close" aria-label="Close" autoFocus onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="acute-ai-settings__body">
          <div className="acute-ai-settings__footer-row acute-ai-settings__mode">
            <div>
              <div className="acute-ai-settings__footer-title">AI features</div>
              <p className="acute-ai-settings__footer-hint">Off hides every ✨ AI action and makes no AI requests.</p>
            </div>
            <div className="acute-ai-mode" role="radiogroup" aria-label="AI features">
              {(["on", "off"] as const).map((m) => (
                <label key={m} className={aiMode === m ? "active" : ""}>
                  <input type="radio" name="acute-ai-mode" checked={aiMode === m} onChange={() => void setAIMode(m)} />
                  {m === "on" ? "On" : "Off"}
                </label>
              ))}
            </div>
          </div>
          <div className="acute-ai-settings__footer-row acute-ai-settings__mode">
            <div>
              <div className="acute-ai-settings__footer-title">Save AI conversations on this device</div>
              <p className="acute-ai-settings__footer-hint">
                Keeps Ask AI conversations so you can reopen and continue them. Never included in workspace exports.{" "}
                <button
                  type="button"
                  className="acute-ask-ai__link acute-ask-ai__link--danger"
                  onClick={() => {
                    if (window.confirm("Delete every saved AI conversation on this device? This can't be undone.")) void getConversationStore().deleteAllEverywhere();
                  }}
                >
                  Delete all saved conversations
                </button>
              </p>
            </div>
            <div className="acute-ai-mode" role="radiogroup" aria-label="Save AI conversations">
              {([true, false] as const).map((on) => (
                <label key={String(on)} className={saveConversations === on ? "active" : ""}>
                  <input type="radio" name="acute-ai-save" checked={saveConversations === on} onChange={() => void getConversationStore().setSaving(on)} />
                  {on ? "On" : "Off"}
                </label>
              ))}
            </div>
          </div>
          <div className="acute-ai-settings__footer-row acute-ai-settings__mode">
            <div>
              <div className="acute-ai-settings__footer-title">Show AI additions</div>
              <p className="acute-ai-settings__footer-hint">
                A pulsing green dot marks each object an accepted AI change adds, so new content is easy to spot. Click a dot to dismiss it.
              </p>
            </div>
            <div className="acute-ai-mode" role="radiogroup" aria-label="Show AI additions">
              {MARKER_OPTIONS.map((o) => (
                <label key={o.value} className={markers === o.value ? "active" : ""}>
                  <input
                    type="radio"
                    name="acute-ai-markers"
                    checked={markers === o.value}
                    onChange={() => {
                      setUiPref("aiChangeMarkers", o.value);
                      if (o.value === "off") aiMarkers.clearAll();
                    }}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
          <ResponseStyleSettings />
          <CleanupSettings />
          {GROUPS.map((group) => {
            const descriptors = AI_PROVIDER_DESCRIPTORS.filter((d) => d.accessType === group.type && !d.hidden);
            if (!descriptors.length) return null;
            return (
              <section key={group.type} aria-labelledby={`acute-ai-group-${group.type}`}>
                <div className="acute-ai-group__heading">
                  <span id={`acute-ai-group-${group.type}`} className="acute-ai-group__label">
                    {group.label}
                  </span>
                  <span className="acute-ai-group__hint">{group.hint}</span>
                </div>
                <div className="acute-ai-group__list">
                  {descriptors.map((descriptor) => (
                    <ConnectionRow
                      key={descriptor.id}
                      descriptor={descriptor}
                      config={configById.get(descriptor.id)}
                      isPrimary={primaryId === descriptor.id}
                      primaryAuto={primaryAuto}
                      busy={busy?.id === descriptor.id ? busy.action : null}
                      testResult={testResults[descriptor.id]}
                      onConnect={() => setConnectingId(descriptor.id)}
                      onDisconnect={() => run(descriptor.id, () => connections.disconnect(descriptor.id))}
                      onMakePrimary={() => run(descriptor.id, () => connections.setPrimary(descriptor.id))}
                      onModelChange={(model) => run(descriptor.id, () => connections.updateModel(descriptor.id, model))}
                      onTest={() => test(descriptor.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          <div className="acute-ai-settings__footer">
            <div className="acute-ai-settings__footer-row">
              <div>
                <div className="acute-ai-settings__footer-title">Fallback</div>
                <p className="acute-ai-settings__footer-hint">
                  Used only when your primary is unavailable. A fallback on your own API key may incur charges.
                </p>
              </div>
              <select
                className="acute-input acute-input--compact"
                aria-label="Fallback connection"
                value={fallbackId ?? ""}
                disabled={!fallbackOptions.length}
                onChange={(e) => run("__fallback__", () => connections.setFallback(e.target.value || null))}
              >
                <option value="">Off</option>
                {fallbackOptions.map((c) => (
                  <option key={c.providerId} value={c.providerId}>
                    {connections.getDescriptor(c.providerId)?.name ?? c.providerId}
                  </option>
                ))}
              </select>
            </div>
            <div className="acute-ai-settings__footer-row">
              <div>
                <div className="acute-ai-settings__footer-title">Decision model</div>
                <p className="acute-ai-settings__footer-hint">
                  Optional. A faster model for quick routing steps (outlining a document, Lens navigation), tried before your primary. Pick any connection and
                  type one of its models; if it fails, your primary answers.
                </p>
              </div>
              <div className="acute-ai-settings__decision">
                <select
                  className="acute-input acute-input--compact"
                  aria-label="Decision model connection"
                  value={decisionConn}
                  disabled={!configs.length}
                  onChange={(e) => {
                    const id = e.target.value;
                    setDecisionConn(id);
                    if (!id) run("__decision__", () => connections.setDecisionModel(null));
                    else if (decisionModel.trim()) run("__decision__", () => connections.setDecisionModel({ connectionId: id, model: decisionModel }));
                    // Nothing typed yet: offer the connection's suggested model (applied once the name is confirmed).
                    else setDecisionModel(connections.getDescriptor(id)?.suggestedDecisionModel ?? "");
                  }}
                >
                  <option value="">Off</option>
                  {configs.map((c) => (
                    <option key={c.providerId} value={c.providerId}>
                      {connections.getDescriptor(c.providerId)?.name ?? c.providerId}
                    </option>
                  ))}
                </select>
                <input
                  className="acute-input acute-input--compact"
                  aria-label="Decision model name"
                  placeholder={connections.getDescriptor(decisionConn)?.suggestedDecisionModel ?? "Model, e.g. gpt-4o-mini"}
                  value={decisionModel}
                  disabled={!decisionConn}
                  onChange={(e) => setDecisionModel(e.target.value)}
                  onBlur={() => decisionConn && decisionModel.trim() && run("__decision__", () => connections.setDecisionModel({ connectionId: decisionConn, model: decisionModel }))}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </div>
            </div>
            {typedOptions.length > 0 && (
              <div className="acute-ai-settings__footer-row">
                <div>
                  <div className="acute-ai-settings__footer-title">Typed decision model</div>
                  <p className="acute-ai-settings__footer-hint">
                    Optional. A dedicated decision model ({typedOptions.map((o) => o.label).join(", ")}) that answers closed questions (Lens search, filing merged content under your topics) faster and
                    for less than a chat model. Uses your {typedOptions.map((o) => o.name).join(" / ")} key and sends it the question, your node names or topics, and the new content being filed. If it&apos;s
                    off or unavailable, the chat model answers as before.
                  </p>
                </div>
                <div className="acute-ai-settings__decision">
                  <select
                    className="acute-input acute-input--compact"
                    aria-label="Typed decision model connection"
                    value={typedConn}
                    onChange={(e) => {
                      const id = e.target.value;
                      setTypedConn(id);
                      const option = typedOptions.find((o) => o.connectionId === id);
                      if (!id) {
                        setTypedModel("");
                        run("__typed__", () => connections.setTypedDecision(null));
                      } else {
                        const model = typedModel.trim() || option?.defaultModel || "";
                        setTypedModel(model);
                        run("__typed__", () => connections.setTypedDecision({ connectionId: id, model }));
                      }
                    }}
                  >
                    <option value="">Off</option>
                    {typedOptions.map((o) => (
                      <option key={o.connectionId} value={o.connectionId}>
                        {o.label} ({o.name})
                      </option>
                    ))}
                  </select>
                  <input
                    className="acute-input acute-input--compact"
                    aria-label="Typed decision model name"
                    placeholder={typedOption?.defaultModel ?? "Model"}
                    value={typedModel}
                    disabled={!typedConn}
                    onChange={(e) => setTypedModel(e.target.value)}
                    onBlur={() => typedConn && typedModel.trim() && run("__typed__", () => connections.setTypedDecision({ connectionId: typedConn, model: typedModel }))}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  />
                </div>
              </div>
            )}
            <UsageSummary />
          </div>
        </div>
      </div>

      {connectingId && (
        <ConnectDialog
          descriptor={connections.getDescriptor(connectingId)!}
          initialModel={configById.get(connectingId)?.model}
          initialEndpoint={(configById.get(connectingId)?.metadata?.endpoint as string | undefined) ?? undefined}
          onCancel={() => setConnectingId(null)}
          onConnected={() => {
            setConnectingId(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ConnectionRow({
  descriptor,
  config,
  isPrimary,
  primaryAuto,
  busy,
  testResult,
  onConnect,
  onDisconnect,
  onMakePrimary,
  onModelChange,
  onTest,
}: {
  descriptor: AIProviderDescriptor;
  config: AIProviderConfig | undefined;
  isPrimary: boolean;
  /** The primary was picked automatically (none chosen); clicking keeps it as the primary. */
  primaryAuto: boolean;
  busy: "test" | "other" | null;
  testResult: TestResult | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  onMakePrimary: () => void;
  onModelChange: (model: string | undefined) => void;
  onTest: () => void;
}) {
  const connected = Boolean(config);
  const isByok = descriptor.accessType !== "subscription";

  return (
    <div className="acute-ai-row">
      <div className="acute-ai-row__info">
        <div className="acute-ai-row__title">
          <span className="acute-ai-row__dot" data-connected={connected || undefined} aria-hidden="true" />
          {descriptor.name}
          {connected && <span className="acute-ai-row__badge">Connected</span>}
        </div>
        <p className="acute-ai-row__billing">{descriptor.billingWording}</p>
      </div>

      <div className="acute-ai-row__actions">
        {connected ? (
          <>
            <button
              type="button"
              className="acute-pill"
              aria-pressed={isPrimary}
              disabled={busy !== null}
              title={
                isPrimary
                  ? primaryAuto
                    ? "Used automatically because no primary is chosen. Click to keep it as your primary."
                    : "This is your primary AI connection"
                  : "Use this connection for AI features"
              }
              onClick={isPrimary && !primaryAuto ? undefined : onMakePrimary}
            >
              {isPrimary ? (primaryAuto ? "★ Primary (auto)" : "★ Primary") : "Set as primary"}
            </button>
            <button type="button" className="acute-pill" disabled={busy !== null} onClick={onTest}>
              {busy === "test" ? "Testing…" : "Test"}
            </button>
            <button type="button" className="acute-pill acute-pill--ghost acute-pill--danger" disabled={busy !== null} onClick={onDisconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <button type="button" className="acute-pill acute-pill--primary" onClick={onConnect}>
            {descriptor.fields.some((f) => f.secret) ? "Connect key" : "Connect"}
          </button>
        )}
      </div>

      {connected && (descriptor.listsModels || config?.model || testResult) && (
        <div className="acute-ai-row__extra">
          {descriptor.listsModels ? (
            <label className="acute-ai-row__meta">
              Model{" "}
              <ModelSelect
                connectionId={descriptor.id}
                value={config?.model}
                compact
                disabled={busy !== null}
                onChange={onModelChange}
              />
            </label>
          ) : (
            config?.model && (
              <span className="acute-ai-row__meta">
                Model <strong>{config.model}</strong>
              </span>
            )
          )}
          {testResult && (
            <span className="acute-ai-status" data-ok={testResult.ok} role="status">
              {testResult.ok ? "✓ Connection works" : `✕ ${testResult.message ?? "Connection failed"}`}
              {!testResult.ok && isByok && <span className="acute-ai-status__hint"> — check the API key, model, and endpoint.</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** "Usage this month" (PRD §6.6): what each connection reported, from the device-local usage log. */
function UsageSummary() {
  const [summary, setSummary] = useState<AIUsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAIUsageRepository()
      .summarize(thisMonth())
      .then((s) => !cancelled && setSummary(s))
      .catch((err: unknown) => console.error("[acute-notes] couldn't read AI usage", err));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;
  const rows = Object.entries(summary.byProvider);

  return (
    <div className="acute-ai-settings__footer-row" aria-label="AI usage this month">
      <div>
        <div className="acute-ai-settings__footer-title">Usage this month</div>
        {rows.length ? (
          <ul className="acute-ai-settings__usage">
            {rows.map(([id, totals]) => (
              <li key={id} className="acute-ai-settings__footer-hint">
                <strong>{connections.getDescriptor(id)?.name ?? id}</strong> {describeUsage(totals)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="acute-ai-settings__footer-hint">No AI requests this month.</p>
        )}
        <p className="acute-ai-settings__footer-hint">As reported by each provider, recorded on this device only. Check your provider for billing.</p>
      </div>
      {rows.length > 0 && (
        <button
          type="button"
          className="acute-pill acute-pill--ghost"
          onClick={() =>
            void getAIUsageRepository()
              .clear()
              .then(() => setSummary({ ...summary, byProvider: {} }))
          }
        >
          Reset
        </button>
      )}
    </div>
  );
}

/** Model picker for connections that can truthfully list their models (`listsModels`). */
function ModelSelect({
  connectionId,
  value,
  compact = false,
  disabled = false,
  autoFocus = false,
  onChange,
}: {
  connectionId: string;
  value: string | undefined;
  compact?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (model: string | undefined) => void;
}) {
  const [models, setModels] = useState<AIModel[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    connections.listModels(connectionId).then(
      (list) => !cancelled && setModels(list),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const unavailable = value && models && !models.some((m) => m.id === value);

  return (
    <select
      className={compact ? "acute-input acute-input--compact" : "acute-input"}
      aria-label="Model"
      value={value ?? ""}
      disabled={disabled || (!models && !failed)}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{models ? "Default" : failed ? "Default (couldn't load models)" : "Loading models…"}</option>
      {unavailable && <option value={value}>{value} — not available</option>}
      {models?.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

function ConnectDialog({
  descriptor,
  initialModel,
  initialEndpoint,
  onCancel,
  onConnected,
}: {
  descriptor: AIProviderDescriptor;
  initialModel: string | undefined;
  initialEndpoint: string | undefined;
  onCancel: () => void;
  onConnected: () => void;
}) {
  const modelField = descriptor.fields.find((f) => f.key === "model");
  const endpointField = descriptor.fields.find((f) => f.key === "endpoint");
  const hasSecret = descriptor.fields.some((f) => f.secret);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(initialModel ?? "");
  const [endpoint, setEndpoint] = useState(initialEndpoint ?? endpointField?.defaultValue ?? "");
  const [storageMode, setStorageMode] = useState<SecretStorageMode>("remember");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    (!hasSecret || apiKey.trim().length > 0) &&
    (!modelField?.required || model.trim().length > 0) &&
    (!endpointField?.required || endpoint.trim().length > 0);

  const submit = () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    connections
      .connect(descriptor.id, {
        model: model.trim() || undefined,
        endpoint: endpoint.trim() || undefined,
        secret: hasSecret ? apiKey.trim() : undefined,
        storageMode,
      })
      .then(onConnected)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't connect."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="acute-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="acute-dialog acute-ai-connect"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acute-connect-title"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <h2 id="acute-connect-title">Connect {descriptor.name}</h2>
          <p className="acute-ai-settings__subtitle">{descriptor.billingWording}</p>
        </div>

        {hasSecret && (
          <div className="acute-field">
            <label htmlFor="acute-connect-key" className="acute-field__label">
              API key
              <span className="acute-field__hint">{storageMode === "remember" ? "Encrypted on this device" : "Kept in memory only"}</span>
            </label>
            <div className="acute-field__control">
              <input
                id="acute-connect-key"
                className="acute-input"
                type={showKey ? "text" : "password"}
                value={apiKey}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button type="button" className="acute-icon-toggle" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? "Hide key" : "Show key"}>
                {showKey ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
              </button>
            </div>
          </div>
        )}

        {modelField && (
          <div className="acute-field">
            <label htmlFor="acute-connect-model" className="acute-field__label">
              Model
              {!modelField.required && <span className="acute-field__hint">Optional</span>}
            </label>
            {descriptor.listsModels ? (
              <ModelSelect connectionId={descriptor.id} value={model || undefined} autoFocus={!hasSecret} onChange={(m) => setModel(m ?? "")} />
            ) : (
              <input
                id="acute-connect-model"
                className="acute-input"
                value={model}
                spellCheck={false}
                placeholder={modelField.placeholder ?? "e.g. the model id from your provider"}
                autoFocus={!hasSecret}
                onChange={(e) => setModel(e.target.value)}
              />
            )}
          </div>
        )}

        {endpointField && (
          <div className="acute-field">
            <label htmlFor="acute-connect-endpoint" className="acute-field__label">
              Endpoint
              {endpointField.defaultValue && <span className="acute-field__hint">Change only for a compatible endpoint</span>}
            </label>
            <input
              id="acute-connect-endpoint"
              className="acute-input"
              value={endpoint}
              spellCheck={false}
              placeholder={endpointField.placeholder}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>
        )}

        {hasSecret && (
          <div className="acute-field">
            <span id="acute-connect-storage" className="acute-field__label">
              Key storage
            </span>
            <div className="acute-ai-connect__segmented">
              <div
                className="acute-segmented"
                role="radiogroup"
                aria-labelledby="acute-connect-storage"
                data-selected={storageMode === "session" ? "second" : "first"}
              >
                <button type="button" role="radio" aria-checked={storageMode === "remember"} onClick={() => setStorageMode("remember")}>
                  Remember on this device
                </button>
                <button type="button" role="radio" aria-checked={storageMode === "session"} onClick={() => setStorageMode("session")}>
                  This session only
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="acute-ai-connect__note">
          {descriptor.authFlow === "sdk_signed_in_user" ? (
            <>
              Uses the GitHub account signed in to the Copilot CLI on this machine. Not signed in? Run <code>copilot login</code> in a terminal, then
              connect.
            </>
          ) : descriptor.transport === "browser_direct" ? (
            "Requests are sent directly from this device."
          ) : (
            "Requests pass through the Acute-Notes AI host on this machine, using your credentials."
          )}
        </p>

        {error && <p className="acute-ai-connect__error">{error}</p>}

        <div className="acute-ai-connect__actions">
          <button type="button" className="acute-pill acute-pill--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="acute-pill acute-pill--primary" disabled={!canSubmit || busy}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
