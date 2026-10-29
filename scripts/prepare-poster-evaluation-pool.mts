import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import pg from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
config({ path: ".env.local", quiet: true });
const { values } = parseArgs({
  options: {
    baseline: { type: "string" },
    out: { type: "string" },
    "inventory-only": { type: "boolean" },
  },
});
if (!values.baseline || !values.out)
  throw new Error("Provide --baseline results.json --out new-pool-folder");
const out = path.resolve(values.out),
  baseline = JSON.parse(await fs.readFile(values.baseline, "utf8"));
const evaluated = new Set(baseline.results.map((r: any) => r.id));
const connectionString =
  process.env.DATABASE_URL ??
  "postgres://scenic:scenic@127.0.0.1:5432/scenic_route";
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(connectionString).hostname,
  )
)
  throw new Error(
    "This inventory is restricted to the authorized local database",
  );
const db = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 5000,
  options: "-c default_transaction_read_only=on",
});
let rows: any[];
try {
  rows = (
    await db.query(
      "SELECT user_id,poster_id,object_prefix,record FROM poster_publications ORDER BY poster_id",
    )
  ).rows;
} finally {
  await db.end();
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const family = (r: any) =>
  String(r.record.activityId ?? `title:${r.record.title}`);
const knownFamilies = new Set(
  rows.filter((r) => evaluated.has(r.poster_id)).map(family),
);
const fresh = rows.filter((r) => !evaluated.has(r.poster_id));
const novel = fresh.filter((r) => !knownFamilies.has(family(r)));
const routeGroups = [...new Set(novel.map(family))];
const inventory = {
  createdAt: new Date().toISOString(),
  source: "published posters in local database, all authorized local accounts",
  accounts: new Set(rows.map((r) => r.user_id)).size,
  published: rows.length,
  previouslyEvaluated: rows.length - fresh.length,
  newPosters: fresh.length,
  newRouteActivities: routeGroups.length,
  newRoutePosters: novel.length,
  groupingNote:
    "Activity IDs define preliminary route groups. Check spatial overlap and duplicated activities before calling this an independent test set.",
  cases: fresh.map((r) => ({
    id: r.poster_id,
    account: hash(r.user_id).slice(0, 12),
    routeGroup: hash(family(r)).slice(0, 12),
    title: r.record.title,
    style: r.record.styleName ?? r.record.styleId,
    referenceCount: r.record.referenceCount,
    newRouteActivity: !knownFamilies.has(family(r)),
    humanRating: "unrated",
  })),
};
await fs.mkdir(out, { recursive: false });
await fs.writeFile(
  path.join(out, "inventory.json"),
  JSON.stringify(inventory, null, 2),
);
if (values["inventory-only"]) {
  console.log(JSON.stringify({ ...inventory, cases: undefined }));
  process.exit(0);
}
const selected: any[] = [];
for (const group of routeGroups) {
  const eligible = novel.filter(
    (r) =>
      family(r) === group &&
      r.record.spec?.grounding?.images?.length === r.record.referenceCount &&
      r.record.spec.grounding.images.some((i: any) =>
        /schematic/i.test(i.role),
      ),
  );
  const byStyle = new Map<string, any[]>();
  for (const row of eligible) {
    const style = row.record.styleId ?? row.record.styleName ?? "unknown";
    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style)!.push(row);
  }
  let n = 0;
  while (n < 6) {
    let added = false;
    for (const groupRows of byStyle.values()) {
      const row = groupRows.pop();
      if (row) {
        selected.push(row);
        n++;
        added = true;
      }
      if (n === 6) break;
    }
    if (!added) break;
  }
}
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  maxAttempts: 2,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
await fs.mkdir(path.join(out, "images"));
const cache = new Map<string, Promise<string>>();
function asset(row: any, name: string) {
  const key = `posters/${row.user_id}/${row.object_prefix}${name}`;
  if (!cache.has(key))
    cache.set(
      key,
      (async () => {
        let bytes: Buffer;
        try {
          bytes = await fs.readFile(
            path.join("data/posters", row.user_id, row.object_prefix, name),
          );
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
          const result = await s3.send(
            new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
          );
          if (!result.Body) throw new Error("Empty saved image");
          bytes = Buffer.from(await result.Body.transformToByteArray());
        }
        const file = `images/${hash(bytes.toString("base64"))}.png`;
        await fs.writeFile(path.join(out, file), bytes);
        return file;
      })(),
    );
  return cache.get(key)!;
}
let cursor = 0;
const cases: any[] = new Array(selected.length),
  errors: any[] = [];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (cursor < selected.length) {
      const index = cursor++,
        row = selected[index],
        r = row.record;
      try {
        const candidate = await asset(row, `${row.poster_id}.png`),
          references = await Promise.all(
            r.spec.grounding.images.map(async (image: any, i: number) => ({
              role: image.role,
              file: await asset(row, `${row.poster_id}.ref-${i + 1}.png`),
            })),
          );
        cases[index] = {
          id: row.poster_id,
          label: `${r.title} · ${r.styleName ?? r.styleId}`,
          kind: "poster",
          candidate,
          references,
          brief: {
            style: r.spec.style,
            text: r.spec.text,
            landmarks: r.spec.landmarks ?? [],
            editRequests: r.editRequests ?? [],
            generationMode: r.editor?.generationMode ?? "reference",
          },
          provenance: {
            source: "local-account-publication",
            account: hash(row.user_id).slice(0, 12),
            routeGroup: hash(family(row)).slice(0, 12),
            generationModel: r.model,
            createdAt: r.createdAt,
          },
          humanRating: "unrated",
        };
        console.log(
          JSON.stringify({
            downloaded: cases.filter(Boolean).length,
            total: selected.length,
          }),
        );
      } catch (e: any) {
        errors.push({ id: row.poster_id, error: e.name ?? "Download failed" });
      }
    }
  }),
);
const manifest = {
  version: 1,
  createdAt: inventory.createdAt,
  purpose:
    "Untuned route-activity candidates; human labels required before comparison; excludes previously evaluated route activities",
  selection:
    "Up to six posters per new activity, cycling through style groups; no judge results used for selection",
  cases: cases.filter(Boolean),
  errors,
};
await fs.writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify({
    published: rows.length,
    accounts: inventory.accounts,
    newPosters: fresh.length,
    newRouteActivities: routeGroups.length,
    newRoutePosters: novel.length,
    prepared: manifest.cases.length,
    errors: errors.length,
    out,
  }),
);
if (errors.length) process.exitCode = 1;
