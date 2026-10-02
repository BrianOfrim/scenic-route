import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AUTO_PALETTE_ID, POSTER_STYLES, paletteChoiceLabel, showsPalettePicker, styleById, stylePalettes } from "./styles";
import { THEME_EXAMPLES, examplesForTheme, type ThemeExample } from "./themeExampleCatalog";

type Props = {
  single: boolean;
  disabled: boolean;
  selectedStyleIds: string[];
  onToggleTheme: (id: string) => void;
  onSelectTheme: (id: string) => void;
  onApplyPalette: (styleId: string, paletteId: string) => void;
  examples?: ThemeExample[];
};

export function ThemeExamples({ single, disabled, selectedStyleIds, onToggleTheme, onSelectTheme, onApplyPalette, examples = THEME_EXAMPLES }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ThemeExample | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const themes = POSTER_STYLES.filter((style) => examplesForTheme(style.id, examples).length);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => { element.close(); };
  }, [open]);

  useEffect(() => {
    if (!detail) return;
    content.current?.scrollTo({ top: 0 });
    detailHeading.current?.focus({ preventScroll: true });
  }, [detail?.styleId]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    setDetail(null);
    trigger.current?.focus();
  }

  function select(id: string) {
    onSelectTheme(id);
    close();
  }

  if (!themes.length) return null;
  const style = detail ? styleById(detail.styleId) : null;
  const variants = detail ? examplesForTheme(detail.styleId, examples) : [];

  return <>
    <button ref={trigger} type="button" className="chip theme-examples-trigger" disabled={disabled} onClick={() => setOpen(true)}>Browse examples</button>
    {open && createPortal(
      <dialog ref={dialog} className="theme-examples-dialog" aria-labelledby="theme-examples-title" aria-describedby="theme-examples-description"
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="theme-examples-shell">
          <header className="theme-examples-header">
            <div><h2 id="theme-examples-title">Theme examples</h2><p id="theme-examples-description" className="muted">Beltline Trail · Same route, different looks. Your result will vary.</p></div>
            <button type="button" className="chip" onClick={close} aria-label="Close theme examples">Close</button>
          </header>
          <div ref={content} className="theme-examples-content">
            {detail && style ? <>
              <button type="button" className="chip" onClick={() => {
                const id = detail.styleId;
                setDetail(null);
                requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>(`[data-theme-preview="${id}"]`)?.focus());
              }}>All themes</button>
              <div className="theme-example-detail">
                <img className="theme-example-large" src={detail.image} alt={`Beltline Trail in ${style.label}, ${paletteChoiceLabel(style, detail.paletteId)} palette`} />
                <div className="theme-example-options">
                  <h3 ref={detailHeading} tabIndex={-1}>{style.label}</h3>
                  <p className="muted">{paletteChoiceLabel(style, detail.paletteId)}{detail.paletteId === AUTO_PALETTE_ID && showsPalettePicker(style)
                    ? style.colorMode === "canonical" ? ` · Uses ${stylePalettes(style)[0].label} colours` : " · One example of automatic colours"
                    : ""}</p>
                  {single ? <button type="button" className="button" disabled={disabled} onClick={() => select(style.id)}>Use this theme</button> :
                    <label className="theme-example-selection"><input type="checkbox" checked={selectedStyleIds.includes(style.id)} disabled={disabled} onChange={() => onToggleTheme(style.id)} />Select {style.label}</label>}
                  {showsPalettePicker(style) && <>
                    <h3>Palette examples</h3>
                    <p className="muted">View a sample, then apply its palette to this theme.</p>
                    <div className="theme-example-palettes">
                      {variants.map((example) => <button type="button" key={example.paletteId} className={`theme-example-palette${example.paletteId === detail.paletteId ? " is-active" : ""}`} aria-pressed={example.paletteId === detail.paletteId} onClick={() => setDetail(example)}>
                        <img src={example.thumbnail} loading="lazy" alt="" width={300} height={400} />
                        <span>{paletteChoiceLabel(style, example.paletteId)}</span>
                      </button>)}
                    </div>
                    <button type="button" className="button" disabled={disabled} onClick={() => {
                      onApplyPalette(style.id, detail.paletteId);
                      if (single) close();
                    }}>Use theme + {paletteChoiceLabel(style, detail.paletteId)} palette</button>
                    {!single && <p className="muted">Applies this palette only to {style.label}; other selected themes stay selected.</p>}
                  </>}
                </div>
              </div>
            </> : <div className="theme-examples-grid">
              {themes.map((theme) => {
                const sample = examplesForTheme(theme.id, examples)[0];
                return <article key={theme.id} className={`theme-example-card${selectedStyleIds.includes(theme.id) ? " is-selected" : ""}`}>
                  <button type="button" className="theme-example-preview" data-theme-preview={theme.id} aria-label={`View ${theme.label} example${showsPalettePicker(theme) ? " and palettes" : ""}`} onClick={() => setDetail(sample)}>
                    <img src={sample.thumbnail} alt={`Beltline Trail in ${theme.label}`} width={300} height={400} loading="lazy" />
                    <span>View example</span>
                  </button>
                  <div className="theme-example-card-footer"><h3>{theme.label}</h3>
                    {single ? <button type="button" className="chip" disabled={disabled} onClick={() => select(theme.id)}>{selectedStyleIds.includes(theme.id) ? "Selected · Use theme" : "Use this theme"}</button> :
                      <label className="theme-example-selection"><input type="checkbox" aria-label={`Select ${theme.label}`} checked={selectedStyleIds.includes(theme.id)} disabled={disabled} onChange={() => onToggleTheme(theme.id)} />Select theme</label>}
                  </div>
                </article>;
              })}
            </div>}
          </div>
          <footer className="theme-examples-footer"><span className="muted">{single ? "Choose one theme for your poster." : `${selectedStyleIds.length} theme${selectedStyleIds.length === 1 ? "" : "s"} selected · Changes apply as you select.`}</span><button type="button" className="button" onClick={close}>Done</button></footer>
        </div>
      </dialog>, document.body)}
  </>;
}
