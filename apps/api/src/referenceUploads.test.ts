import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalStore, createR2Store, type ObjectStore } from "./storage";
import { resolveReferences, uploadReferences } from "./referenceUploads";
import { buildPlannerMessages } from "./planner";
import { sanitizeForTrace } from "./llmTrace";

const png = Buffer.from("89504e470d0a1a0a", "hex");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
function memoryStore() {
  const objects = new Map<string, Buffer>();
  const signed: string[] = [];
  const store: ObjectStore = {
    ...createLocalStore(), kind: "r2",
    async put(user, name, bytes) { objects.set(`${user}/${name}`, bytes); },
    async get(user, name) { return objects.get(`${user}/${name}`) ?? null; },
    async signedUrl(user, name) { signed.push(`${user}/${name}`); return `https://r2.example/${user}/${name}?signature=secret`; },
  };
  return { store, objects, signed };
}

test("uploaded batches resolve to signed URLs and preserve bytes without crossing accounts", async () => {
  const { store, signed } = memoryStore();
  const batch = await uploadReferences("alice", [dataUrl, dataUrl], store);
  const refs = await resolveReferences("alice", batch.referenceBatchId, true, store);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs[0].bytes, png);
  assert.match(refs[0].url, /^https:/);
  assert.equal(signed.length, 2);
  await assert.rejects(resolveReferences("bob", batch.referenceBatchId, false, store), /not found/);
  await assert.rejects(resolveReferences("alice", "../bob", false, store), /invalid/);
});

test("reject malformed images before writing and reject expired batches", async () => {
  const { store, objects } = memoryStore();
  await assert.rejects(uploadReferences("alice", [dataUrl, "data:image/jpeg;base64,bm90IGFuIGltYWdl"], store), /format/);
  assert.equal(objects.size, 0);
  const batch = await uploadReferences("alice", [dataUrl], store);
  objects.set(`alice/${batch.referenceBatchId}/manifest`, Buffer.from(JSON.stringify({ expiresAt: 0, mimes: ["image/png"] })));
  await assert.rejects(resolveReferences("alice", batch.referenceBatchId, false, store), /expired/);
});

test("R2 signed GET targets the private user-scoped key and expires after 24 hours", async () => {
  const store = createR2Store({ endpoint: "https://account.r2.cloudflarestorage.com", bucket: "test", accessKeyId: "test", secretAccessKey: "test" }, "references/");
  const url = new URL(await store.signedUrl!("alice", "batch/0", 86400));
  assert.equal(url.pathname, "/test/references/alice/batch/0");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "86400");
  assert.ok(url.searchParams.has("X-Amz-Signature"));
  const safe = sanitizeForTrace({ image_url: { url: url.href } });
  assert.ok(!JSON.stringify(safe).includes("X-Amz-Signature"));
  assert.ok(!JSON.stringify(safe).includes("X-Amz-Credential"));
});

test("planner image attachments accept hosted URLs and metadata excludes them", () => {
  const messages = buildPlannerMessages({
    routeOnly: true, activity: {}, title: "Route", subtitle: "", stats: [],
    style: { id: "swiss", label: "Swiss", prompt: "minimal" }, aspectRatio: "2:3", geography: [], pois: [],
    grounding: [{ index: 1, role: "route", legend: "route line", url: "https://r2.example/image?signature=secret" }],
  });
  const content = messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
  assert.equal(content.find(item => item.type === "image_url")?.image_url?.url, "https://r2.example/image?signature=secret");
  assert.ok(!content[0].text?.includes("signature"));
});
