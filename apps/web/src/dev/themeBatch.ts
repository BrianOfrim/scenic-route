import type { ServerGenerationJob } from "../gallery/generationState";
import type { PosterRecord } from "../api";
import { POSTER_STYLES, paletteChoices, planSlotKey } from "../poster/styles";

export const themeBatchSlots = () => POSTER_STYLES.filter(s => s.id !== "custom").flatMap(style =>
  paletteChoices(style).map(palette => ({ styleId: style.id, paletteId: palette.id,
    key: planSlotKey(style.id, palette.id), label: `${style.label} / ${palette.label}` })));

export type BatchTemplate = {
  plan: Record<string, unknown>;
  generate: Record<string, unknown>;
};
export type BatchInput = { title: string; references: string[]; templates: BatchTemplate[]; variants: number };
export type BatchTask = { submissionId: string; template: number; body?: BatchTemplate; posters?: PosterRecord[]; error?: string; retryAllowedAt?: string };
export type ThemeBatchRun = BatchInput & {
  id: string; userId: string; createdAt: string; tasks: BatchTask[]; winners: Record<string, string>;
};

export function createThemeBatch(input: BatchInput, userId: string): ThemeBatchRun {
  if (!Number.isInteger(input.variants) || input.variants < 1 || input.variants > 100) throw new Error("Choose 1–100 variants per combination.");
  const id = crypto.randomUUID();
  return { ...input, id, userId, createdAt: new Date().toISOString(), winners: {},
    // One image per job guarantees the requested count even for models limited to one output.
    tasks: input.templates.flatMap((_, template) => Array.from({ length: input.variants }, () => ({
      submissionId: crypto.randomUUID(), template,
    }))),
  };
}

/** Append one fresh request without changing prior candidates or the selected winner. */
export function addThemeBatchVariant(run: ThemeBatchRun, template: number): BatchTask {
  if (!Number.isInteger(template) || !run.templates[template]) throw new Error("Unknown theme/palette combination");
  const task = { submissionId: crypto.randomUUID(), template };
  run.tasks.push(task);
  return task;
}

export function batchKey(template: BatchTemplate) {
  return planSlotKey(String(template.generate.styleId), String(template.generate.paletteId));
}

const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("scenic-route-theme-batches", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("runs", { keyPath: "id" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function saveThemeBatch(run: ThemeBatchRun) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("runs", "readwrite");
      tx.objectStore("runs").put(run);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Could not save the batch"));
    });
  } finally { db.close(); }
}
export async function loadThemeBatches(userId: string) {
  const db = await database();
  try {
    return await new Promise<ThemeBatchRun[]>((resolve, reject) => {
      const req = db.transaction("runs").objectStore("runs").getAll();
      req.onsuccess = () => resolve((req.result as ThemeBatchRun[]).filter(r => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export const THEME_BATCH_CONCURRENCY = 8;

/** The same saved request is replayed until completion; the API deduplicates submission IDs. */
export async function advanceThemeBatch(run: ThemeBatchRun, services: {
  upload: (references: string[]) => Promise<{ referenceBatchId: string }>;
  save: (run: ThemeBatchRun) => Promise<void>;
  submit: (body: { submissionId: string; jobs: BatchTemplate[] }) => Promise<ServerGenerationJob[]>;
  fetchPoster: (id: string) => Promise<PosterRecord>;
  sleep: () => Promise<void>;
  shouldStop: () => boolean;
  changed: () => void;
  prepare?: () => Promise<void>;
  continueOnError?: boolean;
  taskIds?: readonly string[];
  retryTaskIds?: readonly string[];
  retry?: (jobId: string) => Promise<void>;
}) {
  const retried = new Set<string>();
  const failed = new Set<string>();
  const terminalFailures = new Set<string>();
  let lastFailure: unknown;
  while (!services.shouldStop()) {
    await services.prepare?.();
    const tasks = run.tasks.filter(t => !t.posters?.length && !failed.has(t.submissionId) && (!services.taskIds || services.taskIds.includes(t.submissionId))).slice(0, THEME_BATCH_CONCURRENCY);
    if (!tasks.length) {
      if (lastFailure) throw lastFailure;
      return;
    }
    if (tasks.some(task => !task.body)) {
      const refs = await services.upload(run.references);
      for (const task of tasks) {
        if (task.body) continue;
        const template = run.templates[task.template];
        task.body = {
          plan: { ...template.plan, referenceBatchId: refs.referenceBatchId },
          generate: { ...template.generate, batchId: run.id, referenceBatchId: refs.referenceBatchId, variants: 1 },
        };
      }
      // Save every exact request before sending any of this window's submissions.
      await services.save(run);
    }
    if (services.shouldStop()) return;
    let retryChanged = false;
    const results = await Promise.allSettled(tasks.map(async task => {
      const [job] = await services.submit({ submissionId: task.submissionId, jobs: [task.body!] });
      if (!job) throw new Error("The server returned no generation job");
      if (job.state === "failed") {
        task.retryAllowedAt = job.retryAllowedAt;
        if (services.retry && services.retryTaskIds?.includes(task.submissionId) && !retried.has(task.submissionId)) {
          retried.add(task.submissionId);
          await services.retry(job.id);
          delete task.error;
          delete task.retryAllowedAt;
          retryChanged = true;
          return false;
        }
        terminalFailures.add(task.submissionId);
        throw new Error(job.error || "Generation failed");
      }
      if (job.state !== "completed") return false;
      if (!job.resultPosterIds?.length) throw new Error("Completed job has no images");
      task.posters = await Promise.all(job.resultPosterIds.map(services.fetchPoster));
      delete task.error;
      delete task.retryAllowedAt;
      return true;
    }));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        tasks[index].error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failed.add(tasks[index].submissionId);
        lastFailure = result.reason;
      }
    });
    // Let every in-flight response settle before pausing or reporting a failure.
    // Successful siblings must be saved even when another request fails.
    const completed = results.some(result => result.status === "fulfilled" && result.value);
    if (completed || results.some(result => result.status === "rejected") || retryChanged) {
      await services.save(run);
      services.changed();
    }
    const failure = results.find(result => result.status === "rejected");
    const uncertainFailure = results.find((result, index) => result.status === "rejected" && !terminalFailures.has(tasks[index].submissionId));
    if (uncertainFailure?.status === "rejected") throw uncertainFailure.reason;
    if (failure?.status === "rejected" && !services.continueOnError) throw failure.reason;
    // Refill free slots immediately; otherwise wait before polling the same jobs.
    if (!completed && !services.shouldStop()) await services.sleep();
  }
}
