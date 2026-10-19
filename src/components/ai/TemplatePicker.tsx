"use client";

/**
 * Visualize's template picker (F31): Auto plus every unit template, each a
 * small card with a sketch of its layout, its name, and an example of the
 * content it suits. A radio group, so it keys and reads like one.
 */
import type { ReactNode } from "react";
import { SparkleIcon } from "@/components/common/icons";
import { unitTemplates } from "@/ai/visual-plan/templates";
import type { VisualTemplate } from "@/ai/visual-plan/types";

export type TemplateChoice = VisualTemplate | "auto";

const box = (x: number, y: number, w = 10, h = 7) => <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} rx={1.5} />;
const line = (x1: number, y1: number, x2: number, y2: number) => <line key={`${x1},${y1},${x2},${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />;

/** A 48×32 sketch of each template's layout (see `renderer/layout.ts`). */
const SKETCHES: Partial<Record<VisualTemplate, ReactNode>> = {
  flow: [box(2, 12), line(12, 15.5, 19, 15.5), box(19, 12), line(29, 15.5, 36, 15.5), box(36, 12)],
  problem_cause_solution: [box(2, 12), line(12, 15.5, 19, 6), line(12, 15.5, 19, 15.5), line(12, 15.5, 19, 25), box(19, 3), box(19, 12), box(19, 21), line(29, 15.5, 36, 15.5), box(36, 12)],
  concept_map: [<circle key="c" cx={24} cy={16} r={5} />, box(3, 3), box(35, 3), box(3, 22), box(35, 22), line(13, 8, 20, 13), line(35, 8, 28, 13), line(13, 23, 20, 19), line(35, 23, 28, 19)],
  timeline: [line(3, 16, 45, 16), ...[8, 19, 30, 41].map((x) => <circle key={x} cx={x} cy={16} r={2} />), box(3, 4, 10, 6), box(25, 22, 10, 6)],
  decision_tree: [<path key="d" d="M24 2 L30 8 L24 14 L18 8 Z" />, line(20, 11, 11, 20), line(28, 11, 37, 20), box(5, 20), box(32, 20)],
  architecture: [box(2, 5), box(2, 20), line(12, 8.5, 19, 15.5), line(12, 23.5, 19, 15.5), box(19, 12), line(29, 15.5, 36, 8.5), line(29, 15.5, 36, 23.5), box(36, 5), box(36, 20)],
  comparison: [box(5, 3, 16, 5), box(27, 3, 16, 5), box(5, 11, 16, 18), box(27, 11, 16, 18)],
  action_plan: [0, 1, 2].flatMap((i) => [box(4, 4 + i * 9, 6, 6), line(14, 7 + i * 9, 42, 7 + i * 9)]),
};

export function TemplatePicker({ value, onChange }: { value: TemplateChoice; onChange: (t: TemplateChoice) => void }) {
  const options: { id: TemplateChoice; name: string; example: string; sketch: ReactNode }[] = [
    { id: "auto", name: "Auto", example: "Chosen from the content's shape", sketch: null },
    ...unitTemplates().map((t) => ({ id: t.id, name: t.name, example: t.description, sketch: SKETCHES[t.id] ?? null })),
  ];
  return (
    <div className="acute-template-picker" role="radiogroup" aria-label="Template">
      {options.map((o) => (
        <label key={o.id} className="acute-template-picker__option" data-checked={value === o.id || undefined} title={o.example}>
          <input type="radio" name="acute-visualize-template" value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
          <span className="acute-template-picker__sketch" aria-hidden="true">
            {o.sketch ? (
              <svg viewBox="0 0 48 32" width={48} height={32}>
                {o.sketch}
              </svg>
            ) : (
              <SparkleIcon size={18} />
            )}
          </span>
          <span className="acute-template-picker__name">{o.name}</span>
          <span className="acute-template-picker__example">{o.example}</span>
        </label>
      ))}
    </div>
  );
}
