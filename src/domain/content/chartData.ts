/**
 * The JSON shape a `code` node with `language: "acute-chart"` carries (Wave E, bar/line charts): parsing lives
 * here, framework-agnostic, so both the renderer's sizing (`ai/renderer/measure.ts`) and the preview component
 * (`components/blocks/ChartPreview.tsx`) read the same validated shape instead of two copies drifting apart.
 */
export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  chartType: "bar" | "line";
  categories: string[];
  series: ChartSeries[];
}

/** Parses and validates chart JSON; `null` for anything malformed — callers fall back to a plain view, never throw. */
export function parseChart(source: string): ChartData | null {
  try {
    const data = JSON.parse(source) as Partial<ChartData> & { categories?: unknown; series?: unknown };
    if (data.chartType !== "bar" && data.chartType !== "line") return null;
    if (!Array.isArray(data.categories) || !data.categories.length || !data.categories.every((c) => typeof c === "string")) return null;
    if (!Array.isArray(data.series) || !data.series.length) return null;
    for (const s of data.series as unknown[]) {
      if (typeof s !== "object" || s === null) return null;
      const { name, values } = s as Partial<ChartSeries>;
      if (typeof name !== "string" || !Array.isArray(values) || values.length !== data.categories.length) return null;
      if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    }
    return { chartType: data.chartType, categories: data.categories, series: data.series as ChartSeries[] };
  } catch {
    return null;
  }
}
