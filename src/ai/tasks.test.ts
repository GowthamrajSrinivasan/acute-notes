import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTaskRegistry, type TaskDefinition } from "./tasks";

function testTask(overrides: Partial<TaskDefinition<{ text: string }, { label: string }>> = {}): TaskDefinition<{ text: string }, { label: string }> {
  return {
    task: "classify",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ label: z.string() }),
    buildPrompt: ({ input }) => ({ prompt: input.text }),
    policy: {},
    ...overrides,
  };
}

describe("task registry", () => {
  it("registers and retrieves a task definition", () => {
    const registry = createTaskRegistry();
    registry.register(testTask());
    expect(registry.has("classify")).toBe(true);
    expect(registry.get("classify").task).toBe("classify");
  });

  it("rejects registering the same task twice", () => {
    const registry = createTaskRegistry();
    registry.register(testTask());
    expect(() => registry.register(testTask())).toThrow(/already registered/);
  });

  it("throws for an unregistered task", () => {
    const registry = createTaskRegistry();
    expect(() => registry.get("summarize")).toThrow(/no registered definition/);
  });

  it("isolates state between registry instances", () => {
    const a = createTaskRegistry();
    const b = createTaskRegistry();
    a.register(testTask());
    expect(a.has("classify")).toBe(true);
    expect(b.has("classify")).toBe(false);
  });
});
