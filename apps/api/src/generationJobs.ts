import { AccountUnavailableError, withAccountAccess } from "./accountLifecycle";
import { randomUUID } from "node:crypto";
import { getActivity } from "./activities";
import { buildInitialPoster, type PlannerInput } from "./planner";
import { generatePoster, type GeneratePosterBody } from "./poster";
import { maxImageOutputs, OpenRouterError } from "./openrouter";
import { resolveReferences } from "./referenceUploads";
import { providerQueue, type RequestQueue, type JobReservation } from "./requestQueue";

export type JobInput = { plan: PlannerInput; generate: Omit<GeneratePosterBody, "spec"> };
type GenerationJob = {
  id: string;
  userId: string;
  state: "queued" | "generating" | "completed" | "failed";
  input: JobInput;
  planned: ReturnType<typeof buildInitialPoster>;
  error: string | null;
  imageAttempt: number;
  retryAt?: number;
  reservation?: JobReservation;
  createdAt: number;
  updatedAt: number;
};
const services = { getActivity, resolveReferences, maxImageOutputs, prepare: buildInitialPoster, generate: generatePoster };
const RETENTION_MS = 24 * 60 * 60 * 1000;

function publicJobs(jobs: GenerationJob[]) {
  return jobs.map(job => ({
    id: job.id, state: job.state, title: job.input.plan.title,
    model: job.input.generate.model || "", styleId: job.input.generate.styleId,
    paletteId: job.input.generate.paletteId, variants: job.input.generate.variants || 1,
    error: job.error, imageAttempt: job.imageAttempt,
    activityId: Number(job.input.generate.activityId), createdAt: new Date(job.createdAt).toISOString(),
  }));
}
/** Backend-owned jobs for one API process. Restarting intentionally discards them. */
export class GenerationJobQueue {
  private jobs = new Map<string, GenerationJob>();
  private submissions = new Map<string, { result: Promise<string[]>; ids?: string[]; createdAt: number }>();
  private running = new Set<string>();

  constructor(private work = services, private scheduler: RequestQueue = providerQueue("image"), private access = withAccountAccess) {}

  async submit(userId: string, body: { submissionId: string; jobs: JobInput[] }) {
    if (!body || !/^[\w-]{1,100}$/.test(body.submissionId) || !Array.isArray(body.jobs) || !body.jobs.length || body.jobs.length > 200)
      throw new Error("submissionId and 1–200 jobs are required");
    const selections = new Set(body.jobs.map(input => JSON.stringify([input?.generate?.styleId, input?.generate?.paletteId || "auto"])));
    if (selections.size > 8) throw new Error("A generation batch must contain at most eight theme/palette combinations");
    this.prune();
    const key = JSON.stringify([userId, body.submissionId]);
    let submission = this.submissions.get(key);
    if (!submission) {
      const entry: { result: Promise<string[]>; ids?: string[]; createdAt: number } = {
        result: this.prepare(userId, structuredClone(body.jobs)), createdAt: Date.now(),
      };
      submission = entry;
      this.submissions.set(key, entry);
      // Failed validation may be retried; accepted submissions remain deduplicated.
      void entry.result.then(ids => { entry.ids = ids; }, () => { this.submissions.delete(key); });
    }
    return publicJobs((await submission.result).flatMap(id => {
      const job = this.jobs.get(id);
      return job ? [job] : [];
    }));
  }

  private async prepare(userId: string, inputs: JobInput[]) {
    const activities = new Set<number>();
    const references = new Map<string, number>();
    const prepared: ReturnType<typeof buildInitialPoster>[] = [];
    const models = new Map<string, number>();
    for (const input of inputs) {
      if (!input?.generate || !input.plan?.style?.id || !input.plan.referenceBatchId || input.generate.referenceBatchId !== input.plan.referenceBatchId)
        throw new Error("matching uploaded references and a style are required");
      const activityId = Number(input.generate.activityId);
      if (!activities.has(activityId)) {
        if (!(await this.work.getActivity(userId, activityId))) throw new Error("activity not found");
        activities.add(activityId);
      }
      if (!references.has(input.plan.referenceBatchId)) {
        const refs = await this.work.resolveReferences(userId, input.plan.referenceBatchId);
        references.set(input.plan.referenceBatchId, refs.length);
      }
      if (references.get(input.plan.referenceBatchId) !== input.plan.grounding?.length)
        throw new Error("reference metadata must match the uploaded images");
      prepared.push(this.work.prepare(input.plan));
      const model = input.generate.model || "";
      if (!models.has(model)) models.set(model, await this.work.maxImageOutputs(model));
      input.generate.variants = Math.max(1, Math.min(models.get(model)!, Math.floor(input.generate.variants || 1)));
    }
    // Admit the entire batch synchronously after validation, before yielding again.
    const reservations = this.scheduler.reserveJobs(userId, inputs.length);
    return inputs.map((input, index) => {
      const job: GenerationJob = { id: randomUUID(), userId, input, reservation: reservations[index], planned: prepared[index], state: "queued", error: null, imageAttempt: 0, createdAt: Date.now(), updatedAt: Date.now() };
      this.jobs.set(job.id, job);
      return job.id;
    });
  }

  list(userId: string) {
    this.prune();
    return publicJobs([...this.jobs.values()].filter(job => job.userId === userId && job.state !== "completed"));
  }

  retry(userId: string, id: string) {
    const job = this.jobs.get(id);
    if (!job || job.userId !== userId || job.state !== "failed") throw new Error("failed job not found");
    if (this.running.has(id)) throw new Error("This job is still finishing. Please retry shortly.");
    job.reservation = this.scheduler.reserveJobs(userId, 1)[0];
    job.state = "queued";
    job.error = null;
    job.imageAttempt = 0;
    job.retryAt = undefined;
    job.updatedAt = Date.now();
    return publicJobs([job]);
  }

  dismiss(userId: string, id: string) {
    const job = this.jobs.get(id);
    if (job?.userId === userId && job.state === "failed") this.jobs.delete(id);
  }

  /** Enqueue ready jobs once; status changes only when the shared scheduler admits them. */
  dispatch() {
    const pending: Promise<void>[] = [];
    for (const job of this.jobs.values()) {
      if (job.state !== "queued" || this.running.has(job.id) || (job.retryAt && job.retryAt > Date.now())) continue;
      this.running.add(job.id);
      pending.push(this.scheduler.run(async () => {
        job.state = "generating";
        job.updatedAt = Date.now();
        job.retryAt = undefined;
        job.imageAttempt++;
        if (!this.jobs.has(job.id)) return;
        try {
          await this.access(job.userId, false, async () => {
            if (this.jobs.has(job.id)) await this.run(job);
          });
        } catch (error) {
          if (error instanceof AccountUnavailableError) {
            // A deleting account must never be allowed to persist a worker result.
            this.jobs.delete(job.id);
          } else {
            // Fail only work that never reached a terminal/retry state. A lease
            // cleanup failure after successful generation must not invite duplicates.
            if (this.jobs.has(job.id) && job.state === "generating") {
              job.state = "failed";
              job.error = "Unable to access your account for generation. Please retry this job.";
              job.updatedAt = Date.now();
            }
            throw error;
          }
        }
      }, null, job.userId, job.reservation).finally(() => {
        this.running.delete(job.id);
        if (job.state !== "queued" || !this.jobs.has(job.id)) {
          if (job.reservation) this.scheduler.releaseJob(job.reservation);
          job.reservation = undefined;
        }
      }));
    }
    return pending;
  }

  private async run(job: GenerationJob) {
    try {
      const planned = job.planned;
      const body = job.input.generate;
      const editor = body.editor as Record<string, unknown> | undefined;
      const slot = `${body.styleId}::${body.paletteId}`;
      await this.work.generate(job.userId, {
        ...body, spec: planned.spec, prompt: planned.spec.finalPrompt, promptCost: 0, promptModel: undefined,
        editor: editor ? {
          ...editor,
          specs: { ...(editor.specs as object), [slot]: planned.spec },
          planCosts: { ...(editor.planCosts as object), [slot]: planned.cost },
        } : undefined,
      });
      job.state = "completed";
    } catch (error) {
      // Only a completed upstream HTTP error is eligible. Local 502/504
      // wrappers can represent an ambiguous timeout after a paid generation.
      job.state = "failed";
      job.error = error instanceof Error ? error.message : "Generation failed";
      if (job.imageAttempt < 3 && error instanceof OpenRouterError
        && error.providerCode !== "insufficient_credit" && error.providerCode !== "in_flight_budget"
        && [502, 503, 504].includes(error.upstreamStatus ?? 0)) {
        job.state = "queued";
        job.error = null;
        job.retryAt = Date.now() + (job.imageAttempt === 1 ? 5000 : 15000) + Math.random() * 2000;
      }
    } finally {
      job.updatedAt = Date.now();
    }
  }

  removeUser(userId: string) {
    for (const [id, job] of this.jobs) {
      if (job.userId !== userId) continue;
      // Active/dispatched jobs release their reservation when their attempt settles.
      if (job.reservation && !this.running.has(id)) this.scheduler.releaseJob(job.reservation);
      this.jobs.delete(id);
    }
    this.scheduler.cancelWaiting(userId);
    for (const key of this.submissions.keys()) {
      if (JSON.parse(key)[0] === userId) this.submissions.delete(key);
    }
  }

  prune() {
    const cutoff = Date.now() - RETENTION_MS;
    for (const job of this.jobs.values()) {
      if (["completed", "failed"].includes(job.state) && job.updatedAt < cutoff) this.jobs.delete(job.id);
    }
    for (const [key, submission] of this.submissions) {
      if (submission.createdAt < cutoff && submission.ids?.every(id => !this.jobs.has(id))) this.submissions.delete(key);
    }
  }
}

const queue = new GenerationJobQueue();
export const submitGenerationJobs = (userId: string, body: Parameters<GenerationJobQueue["submit"]>[1]) => queue.submit(userId, body);
export const listGenerationJobs = (userId: string) => queue.list(userId);
export const retryGenerationJob = (userId: string, id: string) => queue.retry(userId, id);
export const dismissGenerationJob = (userId: string, id: string) => queue.dismiss(userId, id);

export const removeUserGenerationJobs = (userId: string) => queue.removeUser(userId);

export function startGenerationWorker() {
  const tick = () => {
    try {
      queue.prune();
      for (const pending of queue.dispatch()) {
        void pending.catch(error => console.error("generation job", error));
      }
    } catch (error) { console.error("generation worker", error); }
  };
  const timer = setInterval(tick, 1000);
  tick();
  return () => clearInterval(timer);
}
