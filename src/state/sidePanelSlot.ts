/**
 * The one right-hand panel slot the page panel and Acute Lens share (plan D17): opening one closes the other,
 * whichever store's `open` was called. Not React; `pagePanel` and `lensPanel` each register their own `close`.
 */
type Slot = "page" | "lens";

let current: Slot | null = null;
const closers: Record<Slot, () => void> = { page: () => {}, lens: () => {} };

export function registerSlotCloser(slot: Slot, close: () => void): void {
  closers[slot] = close;
}

/** Call before opening `slot`: closes whichever other slot currently holds it. */
export function claimSlot(slot: Slot): void {
  if (current && current !== slot) closers[current]();
  current = slot;
}

export function releaseSlot(slot: Slot): void {
  if (current === slot) current = null;
}
