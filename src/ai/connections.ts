/**
 * The one module that touches both connection storage (`AISettingsRepository`
 * + `credentialStore`) and `AIProviderManager` (F27). UI calls only these
 * exported functions — never the repository, credential store, or manager
 * directly — the same separation `pageCommands.ts` keeps between UI and
 * `getDocumentStore()`/`getPersistence()`.
 */
import { getPersistence } from "@/persistence";
import { clearSecret, getSecret, setSecret, type SecretStorageMode } from "@/ai/credentials/credentialStore";
import { getAIProviderManager } from "@/ai/providerManager";
import { AI_PROVIDER_DESCRIPTORS, type AIProviderDescriptor } from "@/ai/providers/registry";
import type { AIAuthType, AIModel, AIProviderConfig } from "@/ai/types";
import { createHttpDecisionProvider } from "@/ai/decisions/httpDecisionProvider";
import type { DecisionProvider } from "@/ai/decisions/types";

const PRIMARY_META_KEY = "ai.primaryConnection";
const FALLBACK_META_KEY = "ai.fallbackConnection";
const DECISION_META_KEY = "ai.decisionModel";
const TYPED_DECISION_META_KEY = "ai.typedDecisionModel";

export function getDescriptor(id: string): AIProviderDescriptor | undefined {
  return AI_PROVIDER_DESCRIPTORS.find((d) => d.id === id);
}

/** Every currently-connected configuration, for the settings UI. */
export function listConfigs(): Promise<AIProviderConfig[]> {
  return getPersistence().aiConnections.list();
}

function requireDescriptor(id: string): AIProviderDescriptor {
  const descriptor = getDescriptor(id);
  if (!descriptor) throw new Error(`Unknown AI connection "${id}".`);
  return descriptor;
}

function authTypeFor(descriptor: AIProviderDescriptor): AIAuthType {
  if (descriptor.accessType === "subscription") return "subscription";
  if (descriptor.accessType === "local") return "local";
  return "api_key";
}

async function registerFromStorage(descriptor: AIProviderDescriptor, config: AIProviderConfig): Promise<void> {
  const endpoint = (config.metadata?.endpoint as string | undefined) ?? undefined;
  const secret = await getSecret(descriptor.id);
  const provider = descriptor.createProvider({ model: config.model, endpoint, secret });
  getAIProviderManager().registerProvider(provider);
}

export interface ConnectInput {
  model?: string;
  endpoint?: string;
  /** The API key (BYOK) — omitted for connections with no secret, e.g. GitHub Copilot's local logged-in-user mode. */
  secret?: string;
  storageMode?: SecretStorageMode;
}

/** Connects (or reconfigures) one connection: stores its non-secret config, its secret if any, and registers a live provider. */
export async function connect(id: string, input: ConnectInput): Promise<void> {
  const descriptor = requireDescriptor(id);
  if (input.secret !== undefined) await setSecret(id, input.secret, input.storageMode ?? "remember");

  const config: AIProviderConfig = {
    providerId: id,
    authType: authTypeFor(descriptor),
    model: input.model,
    metadata: input.endpoint ? { endpoint: input.endpoint } : undefined,
  };
  await getPersistence().aiConnections.put(config);
  await registerFromStorage(descriptor, config);
  await resolvePrimary();
  await refreshDecision(id);
  await refreshTypedDecision(id);
}

/** Removes the stored secret and config, and stops the runtime from ever selecting this connection again. */
export async function disconnect(id: string): Promise<void> {
  await clearSecret(id);
  await getPersistence().aiConnections.delete(id);
  getAIProviderManager().unregisterProvider(id);

  const [primary, fallback] = await Promise.all([getPersistence().meta.get<string>(PRIMARY_META_KEY), getPersistence().meta.get<string>(FALLBACK_META_KEY)]);
  if (primary === id) await getPersistence().meta.delete(PRIMARY_META_KEY);
  if (fallback === id) await getPersistence().meta.delete(FALLBACK_META_KEY);
  if ((await getPersistence().meta.get<DecisionSelection>(DECISION_META_KEY))?.connectionId === id) {
    await getPersistence().meta.delete(DECISION_META_KEY);
    getAIProviderManager().setDecisionProvider(null);
  }
  if ((await getPersistence().meta.get<TypedDecisionSelection>(TYPED_DECISION_META_KEY))?.connectionId === id) {
    await getPersistence().meta.delete(TYPED_DECISION_META_KEY);
    getAIProviderManager().setTypedDecisionProvider(null);
  }
  await resolvePrimary();
}

/** Least likely to bill per request first (PRD §13.15.6). */
const ACCESS_PREFERENCE: Record<AIProviderDescriptor["accessType"], number> = { subscription: 0, local: 1, api_key: 2 };

let primaryIsAutomatic = false;

/**
 * Sets the runtime's primary: the user's saved choice when it's connected,
 * otherwise an automatic one: any connected option, preferring subscription,
 * then local, then API-key connections (descriptor order breaks ties). The
 * automatic choice is never saved, so it follows connects and disconnects.
 */
async function resolvePrimary(): Promise<void> {
  const saved = await getPersistence().meta.get<string>(PRIMARY_META_KEY);
  // Read after the await and decide synchronously: a concurrent disconnect
  // must not leave us selecting a provider that was just unregistered.
  const manager = getAIProviderManager();
  const connected = new Set(manager.providerIds());
  if (saved && connected.has(saved)) {
    manager.setPrimary(saved);
    primaryIsAutomatic = false;
    return;
  }
  const fallback = getFallbackId();
  const ranked = AI_PROVIDER_DESCRIPTORS.filter((d) => connected.has(d.id))
    .map((d, order) => ({ d, order }))
    .sort((a, b) => ACCESS_PREFERENCE[a.d.accessType] - ACCESS_PREFERENCE[b.d.accessType] || a.order - b.order)
    .map(({ d }) => d.id);
  const choice = ranked.find((id) => id !== fallback) ?? ranked[0] ?? null;
  manager.setPrimary(choice);
  primaryIsAutomatic = choice !== null;
}

/** True when no primary was chosen and AI uses an automatically picked connection. */
export function isPrimaryAutomatic(): boolean {
  return primaryIsAutomatic && getPrimaryId() !== null;
}

/** At least one connection is connected. */
export function hasConnections(): boolean {
  return getAIProviderManager().providerIds().length > 0;
}

export async function testConnection(id: string): Promise<{ ok: boolean; message?: string }> {
  const config = await getPersistence().aiConnections.get(id);
  if (!config) return { ok: false, message: "Not connected." };
  const descriptor = requireDescriptor(id);
  const endpoint = (config.metadata?.endpoint as string | undefined) ?? undefined;
  const secret = await getSecret(id);
  const candidate = descriptor.createProvider({ model: config.model, endpoint, secret });
  return candidate.testConnection();
}

/** The connection's selectable models — only for descriptors that can truthfully list them (`listsModels`); `[]` otherwise. */
export async function listModels(id: string): Promise<AIModel[]> {
  const descriptor = requireDescriptor(id);
  if (!descriptor.listsModels) return [];
  return (await descriptor.createProvider({}).getModels?.()) ?? [];
}

/** Changes an already-connected connection's model, keeping its secret and endpoint. */
export async function updateModel(id: string, model: string | undefined): Promise<void> {
  const descriptor = requireDescriptor(id);
  const existing = await getPersistence().aiConnections.get(id);
  if (!existing) throw new Error(`AI connection "${id}" is not connected.`);
  const config: AIProviderConfig = { ...existing, model };
  await getPersistence().aiConnections.put(config);
  await registerFromStorage(descriptor, config);
  await refreshDecision(id);
}

/**
 * The decision model (PRD §13.15.9): the model that answers quick routing tasks (the document outline, Lens
 * navigation) before the primary is asked. Any connected connection with any of its models — so a fast model of the
 * primary's own connection, or a different provider's, can be tried and swapped later. A failed or unusable answer
 * from it falls through to the primary silently.
 */
export interface DecisionSelection {
  connectionId: string;
  model: string;
}

/** The decision model as its own provider (the connection's key and endpoint, the chosen model); the connection itself is untouched. */
async function buildDecisionProvider(selection: DecisionSelection) {
  const descriptor = requireDescriptor(selection.connectionId);
  const config = await getPersistence().aiConnections.get(selection.connectionId);
  if (!config) throw new Error(`AI connection "${selection.connectionId}" is not connected.`);
  const endpoint = (config.metadata?.endpoint as string | undefined) ?? undefined;
  const secret = await getSecret(selection.connectionId);
  return descriptor.createProvider({ model: selection.model, endpoint, secret });
}

/** Rebuilds the decision provider after its connection's key, endpoint or model changed. */
async function refreshDecision(connectionId: string): Promise<void> {
  const selection = await getPersistence().meta.get<DecisionSelection>(DECISION_META_KEY);
  if (selection?.connectionId !== connectionId) return;
  getAIProviderManager().setDecisionProvider(await buildDecisionProvider(selection));
}

/** Sets (or, with `null`, clears) the decision model. Requires an already-connected connection and a model. */
export async function setDecisionModel(selection: DecisionSelection | null): Promise<void> {
  if (!selection || !selection.model.trim()) {
    await getPersistence().meta.delete(DECISION_META_KEY);
    getAIProviderManager().setDecisionProvider(null);
    return;
  }
  const clean = { connectionId: selection.connectionId, model: selection.model.trim() };
  const provider = await buildDecisionProvider(clean);
  await getPersistence().meta.set(DECISION_META_KEY, clean);
  getAIProviderManager().setDecisionProvider(provider);
}

/** The saved decision model, `null` when none is set. */
export function getDecisionSelection(): Promise<DecisionSelection | null> {
  return getPersistence().meta.get<DecisionSelection>(DECISION_META_KEY).then((s) => s ?? null);
}

/**
 * The typed decision model (`ai/decisions`): a dedicated model that answers closed questions with typed answers and
 * probabilities (for example Jev on an OpenRouter key). Optional and off until the user enables
 * it; while it is off, or when it fails or is unsure, decision tasks are answered by the chat decision model or the primary, as
 * before (`AIRuntime.decide`). It uses the key of its connection; the connection's own chat model is untouched.
 */
export interface TypedDecisionSelection {
  connectionId: string;
  model: string;
}

/** The connections that can host a typed decision model (their key opens a decisions API), with the model to start from. */
export function typedDecisionOptions(): { connectionId: string; name: string; label: string; defaultModel: string }[] {
  return AI_PROVIDER_DESCRIPTORS.flatMap((d) => (d.decision ? [{ connectionId: d.id, name: d.name, label: d.decision.label, defaultModel: d.decision.defaultModel }] : []));
}

async function buildTypedDecisionProvider(selection: TypedDecisionSelection): Promise<DecisionProvider> {
  const descriptor = requireDescriptor(selection.connectionId);
  if (!descriptor.decision) throw new Error(`${descriptor.name} has no typed decision model.`);
  if (!(await getPersistence().aiConnections.get(selection.connectionId))) throw new Error(`AI connection "${selection.connectionId}" is not connected.`);
  const apiKey = await getSecret(selection.connectionId);
  if (!apiKey) throw new Error(`${descriptor.name} needs an API key for its decision model.`);
  return createHttpDecisionProvider({ id: descriptor.id, name: descriptor.decision.label, vendor: descriptor.decision.vendor, model: selection.model, apiKey });
}

/** Rebuilds the typed decision provider after its connection's key changed. */
async function refreshTypedDecision(connectionId: string): Promise<void> {
  const selection = await getPersistence().meta.get<TypedDecisionSelection>(TYPED_DECISION_META_KEY);
  if (selection?.connectionId !== connectionId) return;
  getAIProviderManager().setTypedDecisionProvider(await buildTypedDecisionProvider(selection));
}

/** Enables (or, with `null`, turns off) the typed decision model. Requires a connected connection that has one, and its key. */
export async function setTypedDecision(selection: TypedDecisionSelection | null): Promise<void> {
  if (!selection || !selection.model.trim()) {
    await getPersistence().meta.delete(TYPED_DECISION_META_KEY);
    getAIProviderManager().setTypedDecisionProvider(null);
    return;
  }
  const clean = { connectionId: selection.connectionId, model: selection.model.trim() };
  const provider = await buildTypedDecisionProvider(clean);
  await getPersistence().meta.set(TYPED_DECISION_META_KEY, clean);
  getAIProviderManager().setTypedDecisionProvider(provider);
}

/** The saved typed decision model, `null` when it is off. */
export function getTypedDecisionSelection(): Promise<TypedDecisionSelection | null> {
  return getPersistence().meta.get<TypedDecisionSelection>(TYPED_DECISION_META_KEY).then((s) => s ?? null);
}

/** The user's explicit primary (saved); `null` clears it and returns to the automatic choice. */
export async function setPrimary(id: string | null): Promise<void> {
  if (id) getAIProviderManager().setPrimary(id);
  if (id) await getPersistence().meta.set(PRIMARY_META_KEY, id);
  else await getPersistence().meta.delete(PRIMARY_META_KEY);
  await resolvePrimary();
}

/** Off by default; `null` turns it off. Requires an already-connected id. */
export async function setFallback(id: string | null): Promise<void> {
  getAIProviderManager().setFallback(id);
  if (id) await getPersistence().meta.set(FALLBACK_META_KEY, id);
  else await getPersistence().meta.delete(FALLBACK_META_KEY);
}

export function getPrimaryId(): string | null {
  return getAIProviderManager().getActiveProvider()?.id ?? null;
}

export function getFallbackId(): string | null {
  return getAIProviderManager().getFallbackProvider()?.id ?? null;
}

/** Loads every stored connection, registers its provider, and restores primary/fallback. Call once at app start. */
export async function loadConnections(): Promise<void> {
  const persistence = getPersistence();
  const configs = await persistence.aiConnections.list();
  for (const config of configs) {
    const descriptor = getDescriptor(config.providerId);
    if (descriptor) await registerFromStorage(descriptor, config);
  }

  const fallback = await persistence.meta.get<string>(FALLBACK_META_KEY);
  if (fallback && configs.some((c) => c.providerId === fallback)) getAIProviderManager().setFallback(fallback);
  const decision = await persistence.meta.get<DecisionSelection>(DECISION_META_KEY);
  if (decision && configs.some((c) => c.providerId === decision.connectionId)) {
    try {
      getAIProviderManager().setDecisionProvider(await buildDecisionProvider(decision));
    } catch (err) {
      console.warn("[acute-notes] The saved decision model couldn't be restored", err);
    }
  }
  const typed = await persistence.meta.get<TypedDecisionSelection>(TYPED_DECISION_META_KEY);
  if (typed && configs.some((c) => c.providerId === typed.connectionId)) {
    try {
      getAIProviderManager().setTypedDecisionProvider(await buildTypedDecisionProvider(typed));
    } catch (err) {
      console.warn("[acute-notes] The saved typed decision model couldn't be restored", err);
    }
  }
  await resolvePrimary();
}
