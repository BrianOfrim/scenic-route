export type ImportFailure = { filename: string; error: string };

export type ImportNotice = {
  tone: "ok" | "mixed" | "error";
  summary: string;
  failures: ImportFailure[];
};

export function formatImportNotice(result: {
  imported: number;
  skipped: number;
  errors: ImportFailure[];
}): ImportNotice | null {
  const imported = result.imported;
  const skipped = result.skipped;
  const errors = result.errors;
  if (imported <= 0 && skipped <= 0 && errors.length === 0) return null;
  if (imported === 1 && skipped <= 0 && errors.length === 0) return null;

  const parts: string[] = [];
  if (imported > 0) {
    parts.push(`Imported ${imported} ${imported === 1 ? "activity" : "activities"}`);
  }
  if (skipped > 0) {
    parts.push(
      skipped === 1 ? "1 file was already in your library" : `${skipped} files were already in your library`,
    );
  }
  if (errors.length > 0) {
    parts.push(
      errors.length === 1 ? "1 file could not be imported" : `${errors.length} files could not be imported`,
    );
  }
  const tone: ImportNotice["tone"] =
    errors.length > 0 && (imported > 0 || skipped > 0) ? "mixed" : errors.length > 0 ? "error" : "ok";
  return { tone, summary: `${parts.join(". ")}.`, failures: errors };
}
