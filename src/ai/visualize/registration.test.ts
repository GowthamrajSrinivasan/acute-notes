/**
 * The app reaches the Visualize tasks only through `visualizeContent`: importing it must register them with the
 * global task registry (a type-only import of `./tasks` is erased by the bundler, and the tasks were never
 * registered — every AI call failed with "has no registered definition"). This file imports nothing else from
 * the Visualize modules on purpose.
 */
import { expect, it } from "vitest";
import { getTaskRegistry } from "@/ai/tasks";
import { visualizeContent } from "./visualize";

it("importing visualizeContent registers the outline and generation tasks", () => {
  expect(typeof visualizeContent).toBe("function");
  expect(getTaskRegistry().has("outline_document")).toBe(true);
  expect(getTaskRegistry().has("generate_visual_plan")).toBe(true);
});
