import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { logger } from "../logger";

type GeographyTiming = { loadId: string; cacheHits: number; cacheMisses: number; inFlight: number };
export const geographyTiming = new AsyncLocalStorage<GeographyTiming>();

export function newGeographyTiming(): GeographyTiming {
  return { loadId: randomUUID(), cacheHits: 0, cacheMisses: 0, inFlight: 0 };
}

/** Debug events are retained in files and hidden from the terminal by default. */
export function logGeographyTiming(event: string, fields: Record<string, unknown>) {
  const context = geographyTiming.getStore();
  if (context) logger.debug("geography.timing", { event, ...context, ...fields });
}
