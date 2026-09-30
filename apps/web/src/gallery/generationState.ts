import { useSyncExternalStore } from "react";

type PendingImage = { id: string; title: string; model: string; styleId?: string; paletteId?: string };
type FailedImage = PendingImage & { error: string; retry: () => Promise<void> };
let snapshot: { failed: FailedImage[]; pending: PendingImage[]; revision: number; error: string | null } = {
  failed: [], pending: [], revision: 0, error: null,
};
const listeners = new Set<() => void>();
function publish(next: typeof snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export type GenerationDetails = { title: string; model?: string; styleId?: string; paletteId?: string; variants?: number };
export type GenerationTask = { finish: (error?: unknown) => void; setRetry: (retry: () => Promise<unknown>) => void };

/** Reserve placeholders synchronously, before any prompt or image work starts. */
export function beginGeneration(details: GenerationDetails): GenerationTask {
  const requestId = crypto.randomUUID();
  const count = Math.max(1, Math.min(8, Math.floor(details.variants || 1)));
  const images = Array.from({ length: count }, (_, index) => ({
    id: `${requestId}:${index}`, title: details.title, model: details.model ?? "", styleId: details.styleId, paletteId: details.paletteId,
  }));
  publish({ ...snapshot, pending: [...snapshot.pending, ...images], error: null });
  let finished = false;
  let retryWork: (() => Promise<unknown>) | undefined;
  const retry = async () => {
    if (!finished || !retryWork) return;
    finished = false;
    publish({ ...snapshot, failed: snapshot.failed.filter((image) => !image.id.startsWith(`${requestId}:`)), pending: [...snapshot.pending, ...images], error: null });
    try {
      await retryWork();
      task.finish();
    } catch (error) {
      task.finish(error);
    }
  };
  const task: GenerationTask = {
    setRetry(work) { retryWork = work; },
    finish(error) {
      if (finished) return;
      finished = true;
      const message = error instanceof Error ? error.message : "Image generation failed";
      publish({
        failed: error == null ? snapshot.failed : [...snapshot.failed, ...images.map((image) => ({ ...image, error: message, retry }))],
        pending: snapshot.pending.filter((image) => !image.id.startsWith(`${requestId}:`)),
        revision: snapshot.revision + 1,
        error: error == null ? snapshot.error : error instanceof Error ? error.message : "Image generation failed",
      });
    },
  };
  return task;
}

/** Reuse a task across prompt preparation and the image request. */
export async function trackGeneration<T>(
  details: GenerationDetails,
  generate: () => Promise<T>,
  task = beginGeneration(details),
): Promise<T> {
  task.setRetry(generate);
  try {
    const result = await generate();
    task.finish();
    return result;
  } catch (cause) {
    task.finish(cause);
    throw cause;
  }
}

export const getGenerationState = () => snapshot;

/** Dismiss a failed placeholder without retrying or affecting active requests. */
export function clearFailedImage(id: string) {
  const failed = snapshot.failed.filter((image) => image.id !== id);
  if (failed.length === snapshot.failed.length) return;
  publish({ ...snapshot, failed, error: failed.at(-1)?.error ?? null });
}

export function useGenerationState() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getGenerationState,
  );
}
