/** Show suggested and previously saved dot-separated locations as editable commas. */
export function locationInput(value: string): string {
  return value.replace(/\s*·\s*/g, ", ");
}

/** Keep poster typography independent of the editable location draft. */
export function locationCaption(value: string): string {
  return value.split(/[,·]/).map(part => part.trim()).filter(Boolean).join(" · ");
}
