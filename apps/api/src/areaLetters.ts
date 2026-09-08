/** A, B, C… private wash index. Keep in sync with apps/web/src/poster/areaLetters.ts */
export function areaLetter(index: number) {
  return String.fromCharCode(65 + (index % 26));
}
