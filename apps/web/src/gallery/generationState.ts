import { useSyncExternalStore } from "react";

export type GenerationPhase = "queued" | "generating";
export const generationPhaseLabels: Record<GenerationPhase, string> = {
  queued: "Queued", generating: "Generating",
};
export type PendingImage = { activityId?: number; previousPosterId?: string; createdAt: string; id: string; title: string; model: string; styleId?: string; paletteId?: string; phase: GenerationPhase; imageAttempt?: number };
type FailedImage = PendingImage & { error: string; retry: () => Promise<void> };
let snapshot: { failed: FailedImage[]; pending: PendingImage[]; revision: number; error: string | null } = {
  failed: [], pending: [], revision: 0, error: null,
};
const listeners = new Set<() => void>();
function publish(next: typeof snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export type GenerationDetails = { title: string; model?: string; styleId?: string; paletteId?: string; variants?: number; activityId?: number; previousPosterId?: string };
export type GenerationTask = { dismiss: () => void; finish: (error?: unknown) => void; setRetry: (retry: () => Promise<unknown>) => void; setPhase: (phase: GenerationPhase) => void };

/** Reserve placeholders synchronously, before any prompt or image work starts. */
export function beginGeneration(details: GenerationDetails): GenerationTask {
  const requestId = crypto.randomUUID();
  const count = Math.max(1, Math.min(8, Math.floor(details.variants || 1)));
  const createdAt = new Date().toISOString();
  const images = Array.from({ length: count }, (_, index) => ({
    activityId: details.activityId, previousPosterId: details.previousPosterId, createdAt,
    id: `${requestId}:${index}`, title: details.title, model: details.model ?? "", styleId: details.styleId, paletteId: details.paletteId, phase: "queued" as const,
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
    dismiss() {
      finished = true;
      const failed = snapshot.failed.filter(image => !image.id.startsWith(`${requestId}:`));
      publish({ ...snapshot,
        pending: snapshot.pending.filter(image => !image.id.startsWith(`${requestId}:`)),
        failed, error: failed.at(-1)?.error ?? null,
        revision: snapshot.revision + 1,
      });
    },
    setPhase(phase) {
      if (finished) return;
      publish({ ...snapshot, pending: snapshot.pending.map(image =>
        image.id.startsWith(`${requestId}:`) ? { ...image, phase } : image) });
    },
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
  generate: (task: GenerationTask) => Promise<T>,
  task = beginGeneration(details),
  initialPhase: GenerationPhase | null = "generating",
): Promise<T> {
  task.setRetry(() => {
    if (initialPhase) task.setPhase(initialPhase);
    return generate(task);
  });
  try {
    if (initialPhase) task.setPhase(initialPhase);
    const result = await generate(task);
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
  if (id.startsWith("server:")) {
    dismissedServerImages.add(id);
    const jobId = id.split(":")[1];
    const siblings = snapshot.failed.filter(image => image.id.startsWith(`server:${jobId}:`));
    if (siblings.every(image => dismissedServerImages.has(image.id))) {
      void serverDismiss?.(jobId).catch(() => { dismissedServerImages.delete(id); serverFingerprint = ""; });
    }
  }
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

export type ServerGenerationJob = {
  id: string; state: "queued" | "generating" | "completed" | "failed";
  title: string; model: string; styleId?: string; paletteId?: string; variants: number; error: string | null;
  imageAttempt?: number; activityId?: number; createdAt?: string;
};
let serverJobs: ServerGenerationJob[] = [];
let serverFingerprint = "";
const dismissedServerImages = new Set<string>();
const retryingServerJobs = new Set<string>();
let serverDismiss: ((id: string) => Promise<void>) | undefined;
export function setServerGenerationJobs(jobs: ServerGenerationJob[], retryJob: (id: string) => Promise<void>, dismissJob: (id: string) => Promise<void>) {
  serverDismiss = dismissJob;
  const fingerprint = JSON.stringify(jobs);
  if (fingerprint === serverFingerprint) return;
  serverFingerprint = fingerprint;
  serverJobs = jobs;
  const pending: PendingImage[] = [];
  const failed: FailedImage[] = [];
  for (const job of jobs) {
    for (let i=0;i<job.variants;i++) {
      const image = { id: `server:${job.id}:${i}`, title: job.title, model: job.model,
        styleId: job.styleId, paletteId: job.paletteId, activityId: job.activityId,
        createdAt: job.createdAt ?? snapshot.pending.find(image => image.id === `server:${job.id}:${i}`)?.createdAt ?? new Date().toISOString(),
        imageAttempt: job.state === "queued" && job.imageAttempt ? job.imageAttempt + 1 : job.imageAttempt,
        phase: (job.state === "generating" ? "generating" : "queued") as GenerationPhase };
      if (job.state === "failed") {
        if (!dismissedServerImages.has(image.id)) failed.push({ ...image, error: job.error || "Generation failed", retry: async () => {
          if (retryingServerJobs.has(job.id)) return;
          retryingServerJobs.add(job.id);
          try { await retryJob(job.id); }
          catch (error) {
            publish({ ...snapshot, failed: snapshot.failed.map(image => image.id.startsWith(`server:${job.id}:`)
              ? { ...image, error: error instanceof Error ? error.message : "Retry failed" } : image) });
          } finally { retryingServerJobs.delete(job.id); }
        } });
      } else if (job.state !== "completed") pending.push(image);
    }
  }
  publish({ ...snapshot, pending: [...snapshot.pending.filter(image => !image.id.startsWith("server:")), ...pending],
    failed: [...snapshot.failed.filter(image => !image.id.startsWith("server:")), ...failed], revision: snapshot.revision+1 });
}
export function mergeServerGenerationJobs(jobs: ServerGenerationJob[], retryJob: (id: string) => Promise<void>, dismissJob: (id: string) => Promise<void>) {
  const ids = new Set(jobs.map(job => job.id));
  setServerGenerationJobs([...serverJobs.filter(job => !ids.has(job.id)), ...jobs],retryJob,dismissJob);
}
