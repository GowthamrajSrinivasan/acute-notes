/**
 * Network synchronization seam (PRD §9.2). The MVP ships only
 * `LocalOnlySyncProvider`; a WebSocket/cloud provider can later implement the
 * same contract without any change to UI or canvas code.
 */
export interface SyncProvider {
  connect(docId: string): Promise<void>;
  disconnect(docId: string): Promise<void>;
  /** Remote updates for any connected document. Returns an unsubscribe fn. */
  onUpdate(callback: (docId: string, update: Uint8Array) => void): () => void;
  sendUpdate(docId: string, update: Uint8Array): void;
}

/** No network: every edit stays on this device. */
export class LocalOnlySyncProvider implements SyncProvider {
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onUpdate(): () => void {
    return () => {};
  }
  sendUpdate(): void {}
}

export const localOnlySync = new LocalOnlySyncProvider();
