"use client";

/**
 * A Mermaid code block drawn as its diagram (F33 preview) wherever blocks are
 * previewed read-only. The `mermaid` library is only loaded the first time a
 * Mermaid block is on screen, never in the initial canvas bundle. Until it has
 * drawn — and whenever the source doesn't parse — the block shows its code, so
 * a half-typed diagram never replaces what the user wrote with an error.
 *
 * Mermaid output is only a preview: `Convert to canvas` (F33) turns the source
 * into native shapes, and the source stays the block's content.
 */
import { memo, useEffect, useState, type ReactNode } from "react";
import { useDocumentTheme } from "@/components/common/useDocumentTheme";

type Drawn = { svg: string } | { error: true };

/** Recently drawn diagrams by theme + source, so re-mounting a preview (zoom, page switch) doesn't redraw it. */
const drawn = new Map<string, Promise<Drawn>>();
const DRAWN_LIMIT = 100;
let library: Promise<typeof import("mermaid").default> | null = null;
let nextId = 0;

function draw(code: string, theme: "light" | "dark"): Promise<Drawn> {
  const key = `${theme}\u0000${code}`;
  let result = drawn.get(key);
  if (!result) {
    result = render(code, theme);
    drawn.set(key, result);
    if (drawn.size > DRAWN_LIMIT) drawn.delete(drawn.keys().next().value!);
  }
  return result;
}

async function render(code: string, theme: "light" | "dark"): Promise<Drawn> {
  try {
    const mermaid = await (library ??= import("mermaid").then((m) => m.default));
    // "strict": no scripts or click handlers in the diagram, labels sanitised.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme === "dark" ? "dark" : "default" });
    // Checked first: a failed `render` can leave Mermaid's error graphic in the page.
    if (!(await mermaid.parse(code, { suppressErrors: true }))) return { error: true };
    const { svg } = await mermaid.render(`acute-mermaid-${nextId++}`, code);
    return { svg };
  } catch {
    return { error: true };
  }
}

export const MermaidPreview = memo(function MermaidPreview({ code, fallback }: { code: string; fallback: ReactNode }) {
  const theme = useDocumentTheme();
  // The last diagram drawn stays up while an edited source is redrawn, instead of flashing back to the code.
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void draw(code, theme).then((result) => {
      if (!live) return;
      if ("svg" in result) {
        setSvg(result.svg);
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [code, theme]);

  if (failed || svg === null) {
    return (
      <>
        {fallback}
        {failed && <p className="acute-preview__mermaid-note">This Mermaid diagram can’t be drawn yet — showing its source.</p>}
      </>
    );
  }
  return (
    <div className="acute-preview__mermaid" role="img" aria-label="Mermaid diagram">
      <span className="acute-preview__lang">mermaid</span>
      {/* Mermaid's own SVG, sanitised by its "strict" security level. */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
});
