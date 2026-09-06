export type LabelBox = { x: number; y: number; w: number; h: number };

export type LabelAnchor = {
  /** Dot position in canvas pixels. */
  x: number;
  y: number;
  /** Measured text size in pixels. */
  w: number;
  h: number;
};

export type PlacedLabel = {
  /** Top-left of the text box. */
  box: LabelBox;
  /** Point on the box edge a leader line should end at; null when the label sits beside its dot. */
  leader: { x: number; y: number } | null;
};

const GAP = 7;
const PAD = 2;

/**
 * Candidate offsets, closest first. `dx`/`dy` are unit directions; `r` is the
 * distance from the dot to the near edge of the label box. Rings beyond the
 * first draw a leader line back to the dot.
 */
const CANDIDATES: Array<{ dx: number; dy: number; r: number }> = [
  { dx: 1, dy: 0, r: GAP },
  { dx: -1, dy: 0, r: GAP },
  { dx: 0, dy: -1, r: GAP },
  { dx: 0, dy: 1, r: GAP },
  { dx: 1, dy: -1, r: GAP },
  { dx: -1, dy: -1, r: GAP },
  { dx: 1, dy: 1, r: GAP },
  { dx: -1, dy: 1, r: GAP },
  ...[26, 46, 70].flatMap((r) =>
    [
      [1, 0],
      [1, -1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [0, 1],
    ].map(([dx, dy]) => ({ dx, dy, r })),
  ),
];

function boxFor(anchor: LabelAnchor, c: { dx: number; dy: number; r: number }): LabelBox {
  const w = anchor.w + PAD * 2;
  const h = anchor.h + PAD * 2;
  const x = c.dx > 0 ? anchor.x + c.r : c.dx < 0 ? anchor.x - c.r - w : anchor.x - w / 2;
  const y = c.dy > 0 ? anchor.y + c.r : c.dy < 0 ? anchor.y - c.r - h : anchor.y - h / 2;
  return { x, y, w, h };
}

export function overlapArea(a: LabelBox, b: LabelBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function outOfBounds(box: LabelBox, width: number, height: number): number {
  const left = Math.max(0, -box.x);
  const top = Math.max(0, -box.y);
  const right = Math.max(0, box.x + box.w - width);
  const bottom = Math.max(0, box.y + box.h - height);
  return (left + right) * box.h + (top + bottom) * box.w;
}

function edgePoint(box: LabelBox, toward: { x: number; y: number }) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.max(box.x, Math.min(box.x + box.w, toward.x));
  const y = Math.max(box.y, Math.min(box.y + box.h, toward.y));
  // If the dot is horizontally beside the box, meet the side; otherwise meet top/bottom.
  if (toward.x < box.x || toward.x > box.x + box.w) return { x, y: Math.max(box.y, Math.min(box.y + box.h, cy)) };
  return { x: Math.max(box.x, Math.min(box.x + box.w, cx)), y };
}

/**
 * Greedy label placement: anchors are handled in order (so callers should pass
 * the most important first), each taking the closest slot that does not
 * collide with an already-placed label, another dot, or the canvas edge.
 * When every slot collides, the least-bad slot is used.
 */
export function placeLabels(
  anchors: LabelAnchor[],
  bounds: { width: number; height: number },
  obstacles: LabelBox[] = [],
): PlacedLabel[] {
  const placed: LabelBox[] = [...obstacles];
  const dots: LabelBox[] = anchors.map((a) => ({ x: a.x - 5, y: a.y - 5, w: 10, h: 10 }));
  const out: PlacedLabel[] = [];
  anchors.forEach((anchor, index) => {
    let best: { box: LabelBox; score: number; c: (typeof CANDIDATES)[number] } | null = null;
    for (const c of CANDIDATES) {
      const box = boxFor(anchor, c);
      let score = outOfBounds(box, bounds.width, bounds.height) * 4;
      for (const other of placed) score += overlapArea(box, other);
      dots.forEach((dot, dotIndex) => {
        if (dotIndex !== index) score += overlapArea(box, dot) * 2;
      });
      if (score === 0) {
        best = { box, score, c };
        break;
      }
      if (!best || score < best.score) best = { box, score, c };
    }
    const chosen = best as { box: LabelBox; score: number; c: (typeof CANDIDATES)[number] };
    placed.push(chosen.box);
    out.push({
      box: chosen.box,
      leader: chosen.c.r > GAP ? edgePoint(chosen.box, anchor) : null,
    });
  });
  return out;
}
