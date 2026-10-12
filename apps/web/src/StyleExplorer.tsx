import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  THEME_GROUPS,
  paletteChoiceLabel,
  showsPalettePicker,
} from "./poster/styles";
import {
  EXPLORER_POSTER_MAX_CSS_PX,
  examplesForTheme,
  type ThemeExample,
} from "./poster/themeExampleCatalog";

type Entry = {
  example: ThemeExample;
  styleId: string;
  styleLabel: string;
  paletteLabel: string | null;
  groupLabel: string;
};

/** Lead the landing gallery with Classic, preserving the remaining category order. */
const LANDING_THEME_GROUPS = [
  ...THEME_GROUPS.filter((group) => group.id === "classic"),
  ...THEME_GROUPS.filter((group) => group.id !== "classic"),
];

/** Every theme + palette combination in landing gallery order. */
const ENTRIES: Entry[] = LANDING_THEME_GROUPS.flatMap((group) =>
  group.styles.flatMap((style) =>
    examplesForTheme(style.id).map((example) => ({
      example,
      styleId: style.id,
      styleLabel: style.label,
      paletteLabel: showsPalettePicker(style) ? paletteChoiceLabel(style, example.paletteId) : null,
      groupLabel: group.label,
    })),
  ),
);

const STYLES = ENTRIES.reduce<{ id: string; label: string; first: number; count: number }[]>(
  (list, entry, index) => {
    const last = list[list.length - 1];
    if (last && last.id === entry.styleId) last.count += 1;
    else list.push({ id: entry.styleId, label: entry.styleLabel, first: index, count: 1 });
    return list;
  },
  [],
);

/** Samples are 933×1400. Keep the previous poster up until the next one has decoded. */
function ExplorerPoster({ entry }: { entry: Entry }) {
  const [visible, setVisible] = useState(entry);
  useEffect(() => {
    if (visible.example.image === entry.example.image) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setVisible(entry);
    };
    image.src = entry.example.image;
    return () => {
      cancelled = true;
    };
  }, [entry, visible.example.image]);
  const label = visible.paletteLabel ? `${visible.styleLabel}, ${visible.paletteLabel}` : visible.styleLabel;
  return (
    <div className="landing-explorer-poster">
      <img
        src={visible.example.image}
        alt={`Beltline Trail map in the ${label} style`}
        width={933}
        height={1400}
      />
    </div>
  );
}

export function StyleExplorer() {
  const sectionRef = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const count = ENTRIES.length;

  // Scroll position inside the pinned section picks the look.
  useEffect(() => {
    const section = sectionRef.current;
    const scroller = section?.closest<HTMLElement>(".landing");
    if (!section || !scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const travel = section.getBoundingClientRect().height - scroller.clientHeight;
      const offset = scroller.getBoundingClientRect().top - section.getBoundingClientRect().top;
      const progress = travel > 0 ? Math.min(1, Math.max(0, offset / travel)) : 0;
      setIndex(Math.min(count - 1, Math.floor(progress * count)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [count]);

  const jumpTo = useCallback(
    (target: number) => {
      const section = sectionRef.current;
      const scroller = section?.closest<HTMLElement>(".landing");
      if (!section || !scroller) return;
      const travel = section.getBoundingClientRect().height - scroller.clientHeight;
      const sectionTop =
        section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTo({ top: sectionTop + ((target + 0.5) / count) * travel, behavior: "instant" });
      setIndex(target);
    },
    [count],
  );

  const current = ENTRIES[index];
  const activeStyle = STYLES.findIndex((style) => style.id === current.styleId);
  const pinStyle = { "--glow": current.example.accent.join(" ") } as CSSProperties;

  return (
    <section
      ref={sectionRef}
      className="landing-explorer"
      aria-labelledby="landing-explorer-title"
      style={{ "--explorer-steps": count, "--explorer-poster": `${EXPLORER_POSTER_MAX_CSS_PX}px` } as CSSProperties}
    >
      <div className="landing-explorer-pin" style={pinStyle}>
        <div className="landing-explorer-glow" aria-hidden="true" />
        <div className="landing-explorer-inner">
          <div className="landing-explorer-stage">
            <ExplorerPoster entry={current} />
          </div>

          <div className="landing-explorer-info">
            <h2 id="landing-explorer-title" className="landing-eyebrow landing-explorer-title">
              Styles
            </h2>
            <nav className="landing-explorer-index" aria-label="Styles">
              <ol className="landing-explorer-index-list" style={{ "--active": activeStyle } as CSSProperties}>
                {STYLES.map((style) => {
                  const active = style.id === current.styleId;
                  const palettes = ENTRIES.slice(style.first, style.first + style.count);
                  return (
                    <li key={style.id} data-active={active}>
                      <button
                        type="button"
                        className="landing-explorer-index-name"
                        aria-current={active ? "true" : undefined}
                        onClick={() => jumpTo(style.first)}
                      >
                        {style.label}
                      </button>
                      <div className="landing-explorer-index-more" inert={!active}>
                        <div>
                          <p className="landing-explorer-index-group">{palettes[0].groupLabel}</p>
                          {palettes.length > 1 && (
                            <ol className="landing-explorer-palettes" aria-label={`${style.label} palettes`}>
                              {palettes.map((entry, offset) => {
                                const at = style.first + offset;
                                return (
                                  <li key={entry.example.image}>
                                    <button
                                      type="button"
                                      aria-current={at === index ? "true" : undefined}
                                      style={{ "--swatch": entry.example.accent.join(" ") } as CSSProperties}
                                      onClick={() => jumpTo(at)}
                                    >
                                      <span className="landing-explorer-swatch" aria-hidden="true" />
                                      {entry.paletteLabel}
                                    </button>
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </nav>
            <p className="landing-explorer-hint" data-visible={index === 0} aria-hidden="true">
              Keep scrolling to flip through every look ↓
            </p>
          </div>
        </div>
        <div className="landing-explorer-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${(index + 1) / count})` }} />
        </div>
      </div>
    </section>
  );
}
