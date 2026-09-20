import type { SyncProgress } from "./api";

export const PAGE_LOAD_SYNC = { drain: false, reportErrors: false } as const;

export function shouldContinueStravaSync(progress: SyncProgress, drain: boolean) {
  return drain && !progress.done && !progress.rateLimited;
}
