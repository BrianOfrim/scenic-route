/** A, B, C… private wash index. Names live in the prompt, not on the schematic. */
export function areaLetter(index: number) {
  return String.fromCharCode(65 + (index % 26));
}

export function assignAreaLetters<T extends { name: string }>(
  areas: T[],
): Array<T & { letter: string }> {
  return areas.map((area, index) => ({ ...area, letter: areaLetter(index) }));
}
