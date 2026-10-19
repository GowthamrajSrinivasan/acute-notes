/**
 * Registration + active-selection + explicit-fallback state for AI
 * providers (PRD §13.15.7/§13.15.10). Feature code never touches this
 * directly — only `AIRuntime` resolves providers through it. Stays
 * unaware of the AI error taxonomy on purpose: it is a passive registry,
 * not the place that decides what counts as a retryable failure.
 */
import type { AIProvider } from "./types";
import type { DecisionProvider } from "./decisions/types";

export class AIProviderManager {
  private readonly providers = new Map<string, AIProvider>();
  private primaryId: string | null = null;
  private fallbackId: string | null = null;
  private decisionId: string | null = null;
  /** A decision model that is its own instance (a connection run with another model), not a registered connection. */
  private decisionProvider: AIProvider | null = null;
  private fallbackEnabledFlag = false;
  /** A dedicated typed decision model (a vendor's decisions API, e.g. Jev) when the user enabled one; independent of the chat decision model. */
  private typedDecision: DecisionProvider | null = null;

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** Removes a provider and clears it from primary/fallback/decision, wherever it was selected. */
  unregisterProvider(id: string): void {
    this.providers.delete(id);
    if (this.primaryId === id) this.primaryId = null;
    if (this.fallbackId === id) {
      this.fallbackId = null;
      this.fallbackEnabledFlag = false;
    }
    if (this.decisionId === id) this.decisionId = null;
  }

  setPrimary(id: string | null): void {
    if (id) this.requireProvider(id);
    this.primaryId = id;
  }

  /** `enabled` defaults to true when an id is given, off when clearing the fallback. */
  setFallback(id: string | null, enabled: boolean = id !== null): void {
    if (id) this.requireProvider(id);
    this.fallbackId = id;
    this.fallbackEnabledFlag = id !== null && enabled;
  }

  setDecisionModel(id: string | null): void {
    if (id) this.requireProvider(id);
    this.decisionId = id;
    this.decisionProvider = null;
  }

  /**
   * The decision model as its own provider instance — any connection, with any model (e.g. a fast model of the
   * connection that is also the primary), without replacing that connection's registered provider.
   */
  setDecisionProvider(provider: AIProvider | null): void {
    this.decisionProvider = provider;
    this.decisionId = null;
  }

  /** Ids of every registered provider. */
  providerIds(): string[] {
    return [...this.providers.keys()];
  }

  isFallbackEnabled(): boolean {
    return this.fallbackEnabledFlag && this.fallbackId !== null;
  }

  getActiveProvider(): AIProvider | null {
    if (!this.primaryId) return null;
    return this.providers.get(this.primaryId) ?? null;
  }

  /** `null` whenever fallback isn't explicitly enabled — never used implicitly (§13.15.10). */
  getFallbackProvider(): AIProvider | null {
    if (!this.isFallbackEnabled() || !this.fallbackId) return null;
    return this.providers.get(this.fallbackId) ?? null;
  }

  setTypedDecisionProvider(provider: DecisionProvider | null): void {
    this.typedDecision = provider;
  }

  getTypedDecisionProvider(): DecisionProvider | null {
    return this.typedDecision;
  }

  getDecisionProvider(): AIProvider | null {
    if (this.decisionProvider) return this.decisionProvider;
    if (!this.decisionId) return null;
    return this.providers.get(this.decisionId) ?? null;
  }

  private requireProvider(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`AI provider "${id}" is not registered.`);
    }
  }
}

let manager: AIProviderManager | null = null;

/** App-wide provider manager. */
export function getAIProviderManager(): AIProviderManager {
  if (!manager) manager = new AIProviderManager();
  return manager;
}
