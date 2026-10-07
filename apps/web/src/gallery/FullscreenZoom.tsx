import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Zoom surface for fullscreen gallery posters. Remount when the poster changes. */
export function FullscreenZoom({ children }: { children: ReactNode }) {
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const previousZoom = useRef(1);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const ratio = zoom / previousZoom.current;
    element.scrollLeft = (element.scrollLeft + element.clientWidth / 2) * ratio - element.clientWidth / 2;
    element.scrollTop = (element.scrollTop + element.clientHeight / 2) * ratio - element.clientHeight / 2;
    previousZoom.current = zoom;
  }, [zoom]);

  return (
    <div className="fullscreen-zoom">
      <div
        ref={viewport}
        className={`fullscreen-zoom-viewport${zoom > 1 ? " is-zoomed" : ""}`}
        tabIndex={0}
        aria-label="Poster image. Use zoom controls to enlarge, then scroll or drag to explore."
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={() => setZoom(current => current === 1 ? 2 : 1)}
        onPointerDown={(event) => {
          if (zoom === 1 || event.pointerType !== "mouse" || event.button !== 0) return;
          event.preventDefault();
          const element = event.currentTarget;
          element.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
          event.currentTarget.scrollTop = start.top + start.y - event.clientY;
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          drag.current = null;
        }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onDragStart={(event) => event.preventDefault()}
      >
        <div className="fullscreen-zoom-image" style={zoom > 1 ? { width: `${zoom * 100}%`, height: `${zoom * 100}%` } : undefined}>
          {children}
        </div>
      </div>
      <div className="fullscreen-zoom-controls" role="group" aria-label="Poster zoom" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="viewer-control" aria-label="Zoom out" title="Zoom out" disabled={zoom === 1} onClick={() => setZoom(current => Math.max(1, current - 0.5))}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <output aria-live="polite">{Math.round(zoom * 100)}%</output>
        <button type="button" className="viewer-control" aria-label="Zoom in" title="Zoom in" disabled={zoom === 4} onClick={() => setZoom(current => Math.min(4, current + 0.5))}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
        </button>
        <button type="button" className="viewer-control" aria-label="Fit poster to screen" title="Fit poster to screen" disabled={zoom === 1} onClick={() => setZoom(1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
        </button>
      </div>
    </div>
  );
}
