import { describe, expect, it } from "vitest";
import { formatEdited } from "./formatEdited";

describe("formatEdited", () => {
  const now = new Date(2026, 8, 25, 12, 0, 0).getTime();
  it("uses relative time for the last day", () => {
    expect(formatEdited(now - 10_000, now)).toBe("Edited just now");
    expect(formatEdited(now - 5 * 60_000, now)).toBe("Edited 5 min ago");
    expect(formatEdited(now - 3 * 3_600_000, now)).toBe("Edited 3 h ago");
  });
  it("uses a date after a day, with the year only when it differs", () => {
    expect(formatEdited(new Date(2026, 8, 3).getTime(), now)).toMatch(/^Edited /);
    expect(formatEdited(new Date(2026, 8, 3).getTime(), now)).not.toContain("2026");
    expect(formatEdited(new Date(2024, 0, 2).getTime(), now)).toContain("2024");
  });
});
