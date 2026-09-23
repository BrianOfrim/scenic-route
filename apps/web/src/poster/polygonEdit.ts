/** Undoable edits for a geography outline. Points are [lng, lat]. */

export type LngLat = [number, number];

export type GeoEdit =
  | { type: "add"; lng: number; lat: number }
  | { type: "select"; index: number | null }
  | { type: "remove"; index: number }
  | { type: "move-start"; index: number }
  | { type: "move"; index: number; lng: number; lat: number }
  | { type: "move-end" }
  | { type: "rect-start"; lng: number; lat: number }
  | { type: "rect-preview"; lng: number; lat: number }
  | { type: "rect-commit"; lng: number; lat: number };

export type OutlineHistory = {
  points: LngLat[];
  past: LngLat[][];
  future: LngLat[][];
  selected: number | null;
};

const HISTORY_LIMIT = 50;

export function emptyOutline(): OutlineHistory {
  return { points: [], past: [], future: [], selected: null };
}

export function commitOutline(state: OutlineHistory, points: LngLat[], selected: number | null = null): OutlineHistory {
  if (!pointsChanged(state.points, points)) return { ...state, selected };
  return {
    points: clone(points),
    past: [...state.past, clone(state.points)].slice(-HISTORY_LIMIT),
    future: [],
    selected,
  };
}

export function undoOutline(state: OutlineHistory): OutlineHistory {
  const prev = state.past[state.past.length - 1];
  if (!prev) return state;
  return {
    points: clone(prev),
    past: state.past.slice(0, -1),
    future: [clone(state.points), ...state.future].slice(0, HISTORY_LIMIT),
    selected: null,
  };
}

export function redoOutline(state: OutlineHistory): OutlineHistory {
  const next = state.future[0];
  if (!next) return state;
  return {
    points: clone(next),
    past: [...state.past, clone(state.points)].slice(-HISTORY_LIMIT),
    future: state.future.slice(1),
    selected: null,
  };
}

export function liveOutline(state: OutlineHistory, points: LngLat[], selected: number | null = state.selected): OutlineHistory {
  return { ...state, points: clone(points), selected };
}

export function appendOutlinePoint(state: OutlineHistory, point: LngLat): OutlineHistory {
  return commitOutline(state, [...state.points, point], state.points.length);
}

export function removeOutlinePoint(state: OutlineHistory, index: number): OutlineHistory {
  if (index < 0 || index >= state.points.length) return state;
  const points = state.points.filter((_, item) => item !== index);
  const selected =
    state.selected == null ? null : state.selected === index ? null : state.selected > index ? state.selected - 1 : state.selected;
  return commitOutline(state, points, selected);
}

export function pointsChanged(a: LngLat[], b: LngLat[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((point, index) => point[0] !== b[index][0] || point[1] !== b[index][1]);
}

function clone(points: LngLat[]): LngLat[] {
  return points.map((point) => [point[0], point[1]]);
}
