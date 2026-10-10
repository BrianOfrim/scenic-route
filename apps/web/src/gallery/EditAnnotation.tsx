import { useRef, useState, type PointerEvent } from "react";

export type AnnotationPoint = { x: number; y: number };
export type AnnotationStrokes = AnnotationPoint[][];

export function EditAnnotation({ strokes, onChange, disabled }: {
  strokes: AnnotationStrokes;
  onChange: (strokes: AnnotationStrokes) => void;
  disabled: boolean;
}) {
  const [drawing, setDrawing] = useState<AnnotationPoint[]>([]);
  const active = useRef<{ pointerId: number; points: AnnotationPoint[] } | null>(null);
  const total = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  function point(event: PointerEvent<SVGSVGElement>): AnnotationPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }
  function finish(event: PointerEvent<SVGSVGElement>, cancel = false) {
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    active.current = null;
    if (!cancel && current.points.length >= 2) onChange([...strokes, current.points]);
    setDrawing([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <svg
    className={`edit-annotation-overlay ${disabled ? "" : "drawing"}`}
    viewBox="0 0 1000 1000" preserveAspectRatio="none"
    aria-label="Draw an outline around the area to refine"
    onPointerDown={event => {
      if (disabled || active.current || event.button !== 0 || strokes.length >= 32 || total >= 2046) return;
      event.preventDefault();
      const points = [point(event)];
      active.current = { pointerId: event.pointerId, points };
      setDrawing(points);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const current = active.current;
      if (!current || current.pointerId !== event.pointerId || total + current.points.length >= 2048) return;
      const next = point(event);
      const previous = current.points[current.points.length - 1];
      if (Math.hypot(next.x - previous.x, next.y - previous.y) < 0.002) return;
      current.points = [...current.points, next];
      setDrawing(current.points);
    }}
    onPointerUp={event => finish(event)}
    onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => finish(event, true)}
  >
    {[...strokes, drawing].filter(stroke => stroke.length > 1).map((stroke, index) => {
      const points = stroke.map(p => `${p.x * 1000},${p.y * 1000}`).join(" ");
      return <g key={index} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={points} stroke="white" strokeWidth="9" />
        <polyline points={points} stroke="#FF00B8" strokeWidth="6" />
      </g>;
    })}
  </svg>;
}
