import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  THEME_GROUPS,
  paletteChoiceLabel,
  showsPalettePicker,
} from "./poster/styles";
import { examplesForTheme, type ThemeExample } from "./poster/themeExampleCatalog";

type Entry = {
  example: ThemeExample;
  styleId: string;
  styleLabel: string;
  paletteLabel: string | null;
  groupLabel: string;
};

/** Every theme + palette combination, in the same browsing order the app uses. */
const ENTRIES: Entry[] = THEME_GROUPS.flatMap((group) =>
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

/** Average of the most colorful pixels: the accent that gives each look its identity. */
function accentOf(image: HTMLImageElement): [number, number, number] | null {
  try {
    const width = 48;
    const height = 72;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const pixels: { r: number; g: number; b: number; chroma: number }[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      pixels.push({ r, g, b, chroma: Math.max(r, g, b) - Math.min(r, g, b) });
    }
    pixels.sort((a, b) => b.chroma - a.chroma);
    const top = pixels.slice(0, Math.max(1, Math.round(pixels.length * 0.03)));
    const sum = top.reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 });
    const mean = [sum.r, sum.g, sum.b].map((value) => value / top.length);
    // Push away from grey so the glow reads as a color, not a smudge.
    const luma = mean[0] * 0.3 + mean[1] * 0.59 + mean[2] * 0.11;
    const [r, g, b] = mean.map((value) => Math.round(Math.min(255, Math.max(0, luma + (value - luma) * 1.7))));
    return [r, g, b];
  } catch {
    return null;
  }
}

/** Thumbnail shows instantly while the full-size image streams in on top. */
function ExplorerImage({ entry }: { entry: Entry }) {
  const [ready, setReady] = useState(false);
  const fullRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth) setReady(true);
  }, []);
  const label = entry.paletteLabel ? `${entry.styleLabel}, ${entry.paletteLabel}` : entry.styleLabel;
  return (
    <div className="landing-explorer-poster">
      <img src={entry.example.thumbnail} alt="" width={267} height={400} />
      <img
        ref={fullRef}
        src={entry.example.image}
        alt={`Beltline Trail map in the ${label} style`}
        width={933}
        height={1400}
        data-ready={ready}
        onLoad={() => setReady(true)}
      />
    </div>
  );
}

export function StyleExplorer() {
  const sectionRef = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [accents, setAccents] = useState<Record<string, [number, number, number]>>({});
  const held = useRef<HTMLImageElement[]>([]);
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

  // Warm every thumbnail (and sample its accent color) once the section is near.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (hits) => {
        if (!hits.some((hit) => hit.isIntersecting)) return;
        observer.disconnect();
        const found: Record<string, [number, number, number]> = {};
        let pending = ENTRIES.length;
        for (const entry of ENTRIES) {
          const image = new Image();
          image.onload = image.onerror = () => {
            const accent = image.naturalWidth ? accentOf(image) : null;
            if (accent) found[entry.example.thumbnail] = accent;
            pending -= 1;
            if (pending === 0 && !cancelled) setAccents(found);
          };
          image.src = entry.example.thumbnail;
          held.current.push(image);
        }
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(section);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  // Keep the full-size images around the current look ready for rapid scrolling.
  useEffect(() => {
    for (let step = -3; step <= 6; step += 1) {
      const entry = ENTRIES[index + step];
      if (!entry) continue;
      const image = new Image();
      image.src = entry.example.image;
      held.current.push(image);
    }
    if (held.current.length > 160) held.current.splice(0, held.current.length - 160);
  }, [index]);

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
  const accent = accents[current.example.thumbnail];
  const pinStyle = { "--glow": accent ? accent.join(" ") : "184 201 122" } as CSSProperties;

  return (
    <section
      ref={sectionRef}
      className="landing-explorer"
      aria-labelledby="landing-explorer-title"
      style={{ "--explorer-steps": count } as CSSProperties}
    >
      <div className="landing-explorer-pin" style={pinStyle}>
        <div className="landing-explorer-glow" aria-hidden="true" />
        <div className="landing-explorer-inner">
          <div className="landing-explorer-stage">
            <ExplorerImage key={current.example.image} entry={current} />
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
                                const swatch = accents[entry.example.thumbnail];
                                return (
                                  <li key={entry.example.image}>
                                    <button
                                      type="button"
                                      aria-current={at === index ? "true" : undefined}
                                      style={swatch ? ({ "--swatch": swatch.join(" ") } as CSSProperties) : undefined}
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
