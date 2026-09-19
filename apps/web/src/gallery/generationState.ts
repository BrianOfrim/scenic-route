import { useSyncExternalStore } from "react";

type PendingImage = { id: string; title: string; model: string; styleId?: string };
let snapshot: { pending: PendingImage[]; revision: number; error: string | null } = {
  pending: [], revision: 0, error: null,
};
const listeners = new Set<() => void>();
function publish(next: typeof snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export type GenerationDetails = { title: string; model?: string; styleId?: string; variants?: number };
export type GenerationTask = { finish: (error?: unknown) => void };

/** Reserve placeholders synchronously, before any prompt or image work starts. */
export function beginGeneration(details: GenerationDetails): GenerationTask {
  const requestId = crypto.randomUUID();
  const count = Math.max(1, Math.min(8, Math.floor(details.variants || 1)));
  const images = Array.from({ length: count }, (_, index) => ({
    id: `${requestId}:${index}`, title: details.title, model: details.model ?? "", styleId: details.styleId,
  }));
  publish({ ...snapshot, pending: [...snapshot.pending, ...images], error: null });
  let finished = false;
  return {
    finish(error) {
      if (finished) return;
      finished = true;
      publish({
        pending: snapshot.pending.filter((image) => !image.id.startsWith(`${requestId}:`)),
        revision: snapshot.revision + 1,
        error: error == null ? snapshot.error : error instanceof Error ? error.message : "Image generation failed",
      });
    },
  };
}

/** Reuse a task across prompt preparation and the image request. */
export async function trackGeneration<T>(
  details: GenerationDetails,
  generate: () => Promise<T>,
  task = beginGeneration(details),
): Promise<T> {
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

export function useGenerationState() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getGenerationState,
  );
}
