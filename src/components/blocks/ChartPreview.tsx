"use client";

/**
 * A bar/line chart drawn from a `codeBlock`'s JSON source wherever blocks are previewed read-only (Wave E,
 * content fidelity plan: "bar/line charts for numeric tables, the table stays as level-2 detail" — this preview
 * is the chart that accompanies a table, never a replacement for it). Plain inline SVG, no charting library —
 * same reasoning as `MermaidPreview.tsx`'s own choice, and the parse is synchronous so there's nothing to load.
 *
 * Colors and mark specs follow the data-viz skill's reference palette (`references/palette.md`): the 8-hue
 * categorical order (never reordered or cycled), thin marks, rounded bar ends, a 2px surface ring on line-end
 * markers, hairline recessive gridlines, a legend for 2+ series (none for one), and sparing direct labels (only
 * for a single series, where "value at the tip" doesn't compete with anything).
 *
 * This is a static preview (like Mermaid's), not an interactive dashboard: no crosshair/zoom/filter layer — each
 * mark still carries a native `<title>` for a basic hover value, same spirit as the skill's "ship hover" rule at
 * a scope that fits a read-only block preview.
 */
import { useDocumentTheme } from "@/components/common/useDocumentTheme";
import { parseChart, type ChartData } from "@/domain/content/chartData";

const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;

interface Ink {
  primary: string;
  secondary: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
}

const INK: Record<"light" | "dark", Ink> = {
  light: { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", surface: "#fcfcfb" },
  dark: { primary: "#ffffff", secondary: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835", surface: "#1a1a19" },
};

/** A clean axis ceiling above `max` (0 stays 0; never negative — chart values are counts/magnitudes). */
function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

const WIDTH = 480;
const HEIGHT = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 44 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const GRID_STEPS = 4;
const BAR_MAX = 24;
const BAR_GAP = 2;

export function ChartPreview({ source, fallback }: { source: string; fallback: React.ReactNode }) {
  const theme = useDocumentTheme();
  const data = parseChart(source);
  if (!data) return <>{fallback}</>;

  const colors = CATEGORICAL[theme];
  const ink = INK[theme];
  const max = niceCeiling(Math.max(0, ...data.series.flatMap((s) => s.values)));
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;
  const groupW = PLOT_W / data.categories.length;
  const x = (i: number) => PAD.left + groupW * i + groupW / 2;

  const gridlines = Array.from({ length: GRID_STEPS + 1 }, (_, i) => {
    const value = (max / GRID_STEPS) * i;
    return { value, y: y(value) };
  });

  return (
    <div className="acute-preview__chart" role="img" aria-label={`${data.chartType === "bar" ? "Bar" : "Line"} chart: ${data.series.map((s) => s.name).join(", ")}`}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" style={{ display: "block" }}>
        {gridlines.map((g) => (
          <g key={g.value}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={g.y} y2={g.y} stroke={ink.grid} strokeWidth={1} />
            <text x={PAD.left - 8} y={g.y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={ink.muted}>
              {Math.round(g.value).toLocaleString()}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + PLOT_H} stroke={ink.axis} strokeWidth={1} />
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top + PLOT_H} y2={PAD.top + PLOT_H} stroke={ink.axis} strokeWidth={1} />
        {data.categories.map((c, i) => (
          <text key={c} x={x(i)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" fontSize={10} fill={ink.muted}>
            {c.length > 12 ? `${c.slice(0, 11)}…` : c}
          </text>
        ))}
        {data.chartType === "bar" ? (
          <Bars data={data} colors={colors} x={x} y={y} groupW={groupW} ink={ink} />
        ) : (
          <Lines data={data} colors={colors} x={x} y={y} ink={ink} />
        )}
      </svg>
      {data.series.length > 1 && (
        <ul className="acute-preview__chart-legend">
          {data.series.map((s, i) => (
            <li key={s.name}>
              <span className="acute-preview__chart-swatch" style={{ background: colors[i % colors.length] }} aria-hidden />
              <span style={{ color: ink.secondary }}>{s.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Bars({
  data,
  colors,
  x,
  y,
  groupW,
  ink,
}: {
  data: ChartData;
  colors: readonly string[];
  x: (i: number) => number;
  y: (v: number) => number;
  groupW: number;
  ink: Ink;
}) {
  const n = data.series.length;
  const slot = Math.min(BAR_MAX, groupW / n - BAR_GAP);
  const barsW = slot * n + BAR_GAP * (n - 1);
  const baseline = PAD.top + PLOT_H;
  return (
    <>
      {data.series.map((s, si) => (
        <g key={s.name}>
          {s.values.map((v, ci) => {
            const left = x(ci) - barsW / 2 + si * (slot + BAR_GAP);
            const top = y(v);
            const h = baseline - top;
            const label = n === 1 ? v.toLocaleString() : undefined;
            return (
              <g key={ci}>
                <rect x={left} y={top} width={slot} height={Math.max(0, h)} rx={4} ry={4} fill={colors[si % colors.length]}>
                  <title>
                    {data.categories[ci]} · {s.name}: {v.toLocaleString()}
                  </title>
                </rect>
                {/* Square the baseline corner (the rect's bottom-left/right stay sharp against the axis, only the top is rounded). */}
                <rect x={left} y={baseline - Math.min(4, h)} width={slot} height={Math.min(4, h)} fill={colors[si % colors.length]} />
                {label !== undefined && h > 12 && (
                  <text x={left + slot / 2} y={top - 4} textAnchor="middle" fontSize={10} fill={ink.secondary}>
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </>
  );
}

function Lines({ data, colors, x, y, ink }: { data: ChartData; colors: readonly string[]; x: (i: number) => number; y: (v: number) => number; ink: Ink }) {
  return (
    <>
      {data.series.map((s, si) => {
        const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        const color = colors[si % colors.length];
        const lastIndex = s.values.length - 1;
        return (
          <g key={s.name}>
            <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={y(v)} r={6} fill={ink.surface} />
                <circle cx={x(i)} cy={y(v)} r={4} fill={color}>
                  <title>
                    {data.categories[i]} · {s.name}: {v.toLocaleString()}
                  </title>
                </circle>
              </g>
            ))}
            {data.series.length === 1 && (
              <text x={x(lastIndex) + 6} y={y(s.values[lastIndex]!) - 8} fontSize={10} fill={ink.secondary}>
                {s.values[lastIndex]!.toLocaleString()}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}
