import assert from "node:assert/strict";
import { test } from "node:test";
import { GenerationJobQueue, type JobInput } from "./generationJobs";
import { buildInitialPoster } from "./planner";
import type { withAccountAccess } from "./accountLifecycle";

const unlocked: typeof withAccountAccess = async (_user, _exclusive, run) => run({} as any);
const input: JobInput = {
  plan: { activity: {}, title: "Private ride", subtitle: "", stats: [], style: { id: "test", label: "Test", prompt: "Test" }, aspectRatio: "3:4", grounding: [{ index: 1, role: "route-only", legend: "" }], geography: [], pois: [], referenceBatchId: "alice-reference" },
  generate: { activityId: 42, referenceBatchId: "alice-reference" },
};

test("queue scopes activity/reference ownership, submission replay, retry, dismissal and worker identity", async () => {
  const seen: string[] = [];
  const queue = new GenerationJobQueue({
    getActivity: async (user, id) => id === 42 || (user === "alice" && id === 99) ? { id } as any : null,
    resolveReferences: async (user, batch) => {
      if (batch !== `${user}-reference`) throw new Error("reference batch not found");
      return [{ url: "https://signed.example", mime: "image/png", bytes: null }];
    },
    maxImageOutputs: async () => 1, prepare: buildInitialPoster,
    generate: async user => { seen.push(user); throw new Error("test failure"); },
  }, unlocked);
  const [aliceJob] = await queue.submit("alice", { submissionId: "shared-submission-id", jobs: [input] });
  await assert.rejects(queue.submit("bob", { submissionId: "shared-submission-id", jobs: [input] }), /reference batch not found/);
  const foreignActivity = structuredClone(input);
  foreignActivity.generate.activityId = 99;
  await assert.rejects(queue.submit("bob", { submissionId: "foreign-activity", jobs: [foreignActivity] }), /activity not found/);
  assert.deepEqual(queue.list("bob"), []);
  const bobInput = structuredClone(input);
  bobInput.plan.referenceBatchId = bobInput.generate.referenceBatchId = "bob-reference";
  const [bobJob] = await queue.submit("bob", { submissionId: "shared-submission-id", jobs: [bobInput] });
  assert.notEqual(aliceJob.id, bobJob.id);
  await queue.run(queue.claim()!);
  assert.deepEqual(seen, ["alice"]);
  assert.throws(() => queue.retry("bob", aliceJob.id), /not found/);
  queue.dismiss("bob", aliceJob.id);
  assert.equal(queue.list("alice")[0].state, "failed");
  assert.equal(queue.list("bob")[0].id, bobJob.id);
  queue.dismiss("alice", aliceJob.id);
  assert.deepEqual(queue.list("alice"), []);
  assert.equal(queue.list("bob").length, 1);
  await queue.run(queue.claim()!);
  assert.deepEqual(seen, ["alice", "bob"]);
});
