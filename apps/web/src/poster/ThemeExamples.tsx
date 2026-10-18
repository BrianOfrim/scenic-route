import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AUTO_PALETTE_ID, THEME_GROUPS, paletteIdsForStyle, paletteChoiceLabel, showsPalettePicker, styleById } from "./styles";
import { THEME_EXAMPLES, examplesForTheme, type ThemeExample } from "./themeExampleCatalog";

type Props = {
  single: boolean;
  disabled: boolean;
  selectedStyleIds: string[];
  paletteIdsByStyle: Record<string, string[]>;
  onTogglePalette: (styleId: string, paletteId: string) => void;
  onToggleTheme: (id: string) => void;
  onSelectTheme: (id: string) => void;
  onApplyPalette: (styleId: string, paletteId: string) => void;
  examples?: ThemeExample[];
};

export function ThemeExamples({ single, disabled, selectedStyleIds, paletteIdsByStyle, onTogglePalette, onToggleTheme, onSelectTheme, onApplyPalette, examples = THEME_EXAMPLES }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ThemeExample | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const groups = THEME_GROUPS.map((group) => ({
    ...group,
    styles: group.styles.filter((style) => examplesForTheme(style.id, examples).length),
  })).filter((group) => group.styles.length);

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

  if (!groups.length) return null;
  const style = detail ? styleById(detail.styleId) : null;
  const variants = detail ? examplesForTheme(detail.styleId, examples) : [];

  return <>
    <button ref={trigger} type="button" className="theme-examples-trigger" disabled={disabled} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 5-5 4 4 4-6 5 7" />
      </svg>
      <span>Browse examples</span>
      <span aria-hidden="true">→</span>
    </button>
    {open && createPortal(
      <dialog ref={dialog} className="theme-examples-dialog" aria-labelledby="theme-examples-title" aria-describedby="theme-examples-description"
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="theme-examples-shell">
          <header className="theme-examples-header">
            <div><h2 id="theme-examples-title">Theme examples</h2><p id="theme-examples-description" className="muted">Beltline Trail · Same route, different looks. Your result will vary.</p></div>
            <div className="theme-examples-header-actions">
              {detail && <button type="button" className="chip" onClick={() => {
                const id = detail.styleId;
                setDetail(null);
                requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>(`[data-theme-preview="${id}"]`)?.focus());
              }}>All themes</button>}
              <button type="button" className="chip" onClick={close} aria-label="Close theme examples">Close</button>
            </div>
          </header>
          <div ref={content} className="theme-examples-content">
            {detail && style ? <>
              <div className="theme-example-detail">
                <img className="theme-example-large" src={detail.image} alt={`Beltline Trail in ${style.label}, ${paletteChoiceLabel(style, detail.paletteId)} palette`} />
                <div className="theme-example-options">
                  <h3 ref={detailHeading} tabIndex={-1}>{style.label}</h3>
                  {showsPalettePicker(style) && <p className="muted">{paletteChoiceLabel(style, detail.paletteId)}{detail.paletteId === AUTO_PALETTE_ID
                    ? " · One example of automatic colours"
                    : ""}</p>}
                  {single ? <button type="button" className="button" disabled={disabled} onClick={() => select(style.id)}>Use this theme</button> :
                    <label className="theme-example-selection"><input type="checkbox" checked={selectedStyleIds.includes(style.id)} disabled={disabled} onChange={() => onToggleTheme(style.id)} />Select {style.label}</label>}
                  {showsPalettePicker(style) && <>
                    <h3 className="subheading">Palette examples</h3>
                    <p className="muted">{single ? "View a sample, then apply its palette to this theme." : "Preview a sample or select multiple palettes for this theme."}</p>
                    <div className="theme-example-palettes">
                      {variants.map((example) => {
                        const selected = selectedStyleIds.includes(style.id) && paletteIdsForStyle(style, paletteIdsByStyle[style.id]).includes(example.paletteId);
                        return <div key={example.paletteId} className={`theme-example-palette${selected ? " is-selected" : ""}${example.paletteId === detail.paletteId ? " is-active" : ""}`}>
                          <button type="button" className="theme-example-palette-preview" aria-label={`Preview ${paletteChoiceLabel(style, example.paletteId)} palette`}
                            aria-pressed={example.paletteId === detail.paletteId} onClick={() => setDetail(example)}>
                            <img src={example.thumbnail} loading="lazy" alt="" width={300} height={400} />
                            {single && <span>{paletteChoiceLabel(style, example.paletteId)}</span>}
                          </button>
                          {!single && <label className="theme-example-selection">
                            <input type="checkbox" checked={selected} disabled={disabled} onChange={() => onTogglePalette(style.id, example.paletteId)} />
                            {paletteChoiceLabel(style, example.paletteId)}
                          </label>}
                        </div>;
                      })}
                    </div>
                    {single && <button type="button" className="button" disabled={disabled} onClick={() => {
                      onApplyPalette(style.id, detail.paletteId);
                      close();
                    }}>Use theme + {paletteChoiceLabel(style, detail.paletteId)} palette</button>}
                  </>}
                </div>
              </div>
            </> : <div className="theme-example-groups">
              {groups.map((group) => <section key={group.id} aria-labelledby={`example-group-${group.id}`}>
                <h3 id={`example-group-${group.id}`} className="subheading theme-example-group-heading">{group.label}</h3>
                <div className="theme-examples-grid">
                  {group.styles.map((theme) => {
                    const sample = examplesForTheme(theme.id, examples)[0];
                    return <article key={theme.id} className={`theme-example-card${selectedStyleIds.includes(theme.id) ? " is-selected" : ""}`}>
                      <button type="button" className="theme-example-preview" data-theme-preview={theme.id} aria-label={`View ${theme.label} example${showsPalettePicker(theme) ? " and palettes" : ""}`} onClick={() => setDetail(sample)}>
                        <img src={sample.thumbnail} alt={`Beltline Trail in ${theme.label}`} width={300} height={400} loading="lazy" />
                        <span>View example</span>
                      </button>
                      <div className="theme-example-card-footer"><h4>{theme.label}</h4>
                        {single ? <button type="button" className="chip" disabled={disabled} onClick={() => select(theme.id)}>{selectedStyleIds.includes(theme.id) ? "Selected · Use theme" : "Use this theme"}</button> :
                          <label className="theme-example-selection"><input type="checkbox" aria-label={`Select ${theme.label}`} checked={selectedStyleIds.includes(theme.id)} disabled={disabled} onChange={() => onToggleTheme(theme.id)} />Select theme</label>}
                      </div>
                    </article>;
                  })}
                </div>
              </section>)}
            </div>}
          </div>
          <footer className="theme-examples-footer"><span className="muted">{single ? "Choose one theme for your poster." : `${selectedStyleIds.length} theme${selectedStyleIds.length === 1 ? "" : "s"} selected · Changes apply as you select.`}</span><button type="button" className="button" onClick={close}>Done</button></footer>
        </div>
      </dialog>, document.body)}
  </>;
}
