export const MAX_IMPORT_FILES = 256;
export const MAX_TRACK_BYTES = 15 * 1024 * 1024;
export const MAX_ZIP_BYTES = 250 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 350 * 1024 * 1024; // base64 ZIP plus JSON/form overhead
export const MAX_EXPANDED_TRACK_BYTES = 64 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 20_000;
export const MAX_EXPANDED_TRACKS = 5_000;

export type ExpansionBudget = { bytes: number; tracks: number };
