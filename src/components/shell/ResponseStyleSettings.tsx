"use client";

/**
 * AI settings → Response styling: how AI-generated objects look (see
 * `ai/changes/responseStyle.ts`). Applies to proposals made from now on;
 * objects already on the canvas keep their look.
 */
import { useEffect, useRef, useState } from "react";
import { BLOCK_FONTS, fontCss } from "@/components/blocks/blockFonts";
import { BACKGROUND_PALETTE, TEXT_PALETTE } from "@/components/blocks/palette";
import type { BlockFontId } from "@/domain/content/blockStyle";
import { DEFAULT_RESPONSE_STYLE, type ConnectorStyle, type ResponseStyle } from "@/ai/changes/responseStyle";
import { setUiPref, useUiPref } from "@/state/uiPrefs";

const NAMES = ["default", ...Object.keys(BACKGROUND_PALETTE)] as const;
const label = (name: string) => (name === "default" ? "None" : name[0]!.toUpperCase() + name.slice(1));

/** Light canvas fills (Open Color's lightest shades, as in Excalidraw's palette). */
const CARD_FILLS: { value: string; label: string }[] = [
  { value: "#ffffff", label: "White" },
  { value: "#f8f9fa", label: "Gray" },
  { value: "#fff4e6", label: "Orange" },
  { value: "#fff9db", label: "Yellow" },
  { value: "#ebfbee", label: "Green" },
  { value: "#e7f5ff", label: "Blue" },
  { value: "#f3f0ff", label: "Violet" },
];

const CONNECTORS: { value: ConnectorStyle; label: string }[] = [
  { value: "elbow", label: "Sharp turns" },
  { value: "straight", label: "Straight" },
];

/** Fonts that read well as titles, shown as choices; the rest are under "Other". */
const TITLE_FONTS: readonly string[] = ["default", "inter", "nunito", "lilita", "excalifont"];
const fontLabel = (id: string) => (id === "default" ? "Default" : (BLOCK_FONTS.find((f) => f.id === id)?.label ?? id));

/**
 * The shown fonts: the title fonts, except that a font chosen from "Other" takes the last place,
 * so the choice is always visible (and the font it replaces moves to "Other").
 */
export function visibleTitleFonts(selected: string): string[] {
  return TITLE_FONTS.includes(selected) ? [...TITLE_FONTS] : [...TITLE_FONTS.slice(0, -1), selected];
}

function FontChoices({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = visibleTitleFonts(value);
  const others = ["default", ...BLOCK_FONTS.map((f) => f.id)].filter((id) => !visible.includes(id));

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes this menu only, not the settings dialog around it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>(".acute-style-fonts__other")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const preview = (id: string) => (id === "default" ? undefined : { fontFamily: fontCss(id as BlockFontId) });
  return (
    <div className="acute-style-fonts" ref={ref}>
      <div className="acute-ai-mode" role="radiogroup" aria-label="Title font">
        {visible.map((id) => (
          <label key={id} className={value === id ? "active" : ""} style={preview(id)} title={id === "default" ? "The item's own font" : fontLabel(id)}>
            <input type="radio" name="acute-style-title-font" checked={value === id} onChange={() => onChange(id)} />
            {fontLabel(id)}
          </label>
        ))}
      </div>
      {others.length > 0 && (
        <button type="button" className="acute-style-fonts__other" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Other
        </button>
      )}
      {open && (
        <div className="acute-style-fonts__menu" role="menu" aria-label="Other fonts">
          {others.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              style={preview(id)}
              onClick={() => {
                setOpen(false);
                onChange(id);
              }}
            >
              {fontLabel(id)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Swatches({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: { value: string; label: string; color: string | null }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="acute-style-swatches" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? "active" : ""} title={o.label}>
          <input type="radio" name={`acute-style-${name}`} checked={value === o.value} onChange={() => onChange(o.value)} aria-label={o.label} />
          <span className={o.color ? "" : "acute-style-swatches__none"} style={o.color ? { background: o.color } : undefined} />
        </label>
      ))}
    </div>
  );
}

export function ResponseStyleSettings() {
  const style = useUiPref("aiStyle");
  const set = (patch: Partial<ResponseStyle>) => setUiPref("aiStyle", { ...style, ...patch });
  const isDefault = (Object.keys(DEFAULT_RESPONSE_STYLE) as (keyof ResponseStyle)[]).every((k) => style[k] === DEFAULT_RESPONSE_STYLE[k]);

  const titleBg = style.titleBackground === "default" ? undefined : BACKGROUND_PALETTE[style.titleBackground];
  const titleFg = style.titleColor === "default" ? undefined : TEXT_PALETTE[style.titleColor];
  const titleFont = style.titleFont === "default" ? undefined : fontCss(style.titleFont as BlockFontId);

  return (
    <section className="acute-style-settings acute-ai-settings__mode" aria-labelledby="acute-style-settings-title">
      <div className="acute-ai-settings__footer-row">
        <div>
          <div id="acute-style-settings-title" className="acute-ai-settings__footer-title">
            Response styling
          </div>
          <p className="acute-ai-settings__footer-hint">
            How objects that AI creates on the canvas look. Applies to new AI results; objects already on the canvas keep their look.{" "}
            {!isDefault && (
              <button type="button" className="acute-ask-ai__link" onClick={() => setUiPref("aiStyle", DEFAULT_RESPONSE_STYLE)}>
                Reset to defaults
              </button>
            )}
          </p>
        </div>
        <div className="acute-style-preview" aria-hidden="true" style={{ background: style.cardBackground }}>
          <div className="acute-style-preview__title" style={{ background: titleBg, color: titleFg, fontFamily: titleFont }}>
            Title
          </div>
          <div className="acute-style-preview__line" />
          <div className="acute-style-preview__line acute-style-preview__line--short" />
        </div>
      </div>

      <div className="acute-style-settings__grid">
        <span>Title background</span>
        <Swatches
          name="Title background"
          value={style.titleBackground}
          options={NAMES.map((n) => ({ value: n, label: label(n), color: n === "default" ? null : BACKGROUND_PALETTE[n]! }))}
          onChange={(titleBackground) => set({ titleBackground })}
        />
        <span>Title text</span>
        <Swatches
          name="Title text"
          value={style.titleColor}
          options={NAMES.map((n) => ({ value: n, label: n === "default" ? "Default" : label(n), color: n === "default" ? null : TEXT_PALETTE[n]! }))}
          onChange={(titleColor) => set({ titleColor })}
        />
        <span>Title font</span>
        <FontChoices value={style.titleFont} onChange={(titleFont) => set({ titleFont })} />
        <span>Card background</span>
        <Swatches
          name="Card background"
          value={style.cardBackground}
          options={CARD_FILLS.map((f) => ({ ...f, color: f.value }))}
          onChange={(cardBackground) => set({ cardBackground })}
        />
        <span>Connectors</span>
        <div className="acute-ai-mode" role="radiogroup" aria-label="Connectors">
          {CONNECTORS.map((c) => (
            <label key={c.value} className={style.connectors === c.value ? "active" : ""}>
              <input type="radio" name="acute-style-connectors" checked={style.connectors === c.value} onChange={() => set({ connectors: c.value })} />
              {c.label}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
