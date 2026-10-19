/** "Edited just now" / "Edited 5 min ago" / "Edited Sep 3" — compact, for cards and lists. */
export function formatEdited(updatedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 45) return "Edited just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Edited ${hours} h ago`;
  const date = new Date(updatedAt);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `Edited ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`;
}
