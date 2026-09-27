/** MapLibre treats a failed 1×1 drawing buffer as the permanent canvas cap. */
export const DEFAULT_MAX_CANVAS: [number, number] = [4096, 4096];

export function canvasBitmapCollapsed(
  cssWidth: number,
  cssHeight: number,
  bitmapWidth: number,
  bitmapHeight: number,
): boolean {
  if (cssWidth < 2 || cssHeight < 2) return false;
  return bitmapWidth < 2 || bitmapHeight < 2;
}
