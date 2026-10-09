import fs from "node:fs";
import path from "node:path";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { POSTERS_DIR } from "./paths";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type ObjectStore = {
  kind: "local" | "r2";
  signedUrl?(userId: string, name: string, expiresIn: number): Promise<string>;
  put(userId: string, name: string, body: Buffer, contentType: string): Promise<void>;
  get(userId: string, name: string): Promise<Buffer | null>;
  listJsonNames(userId: string): Promise<string[]>;
  removeUser(userId: string): Promise<void>;
  removeByPosterId(userId: string, posterId: string): Promise<void>;
  removeByActivityIds(userId: string, activityIds: Set<number>): Promise<number>;
  hasUnscopedPosters(): Promise<boolean>;
  migrateUnscopedToUser(userId: string): Promise<void>;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function r2Config() {
  const accessKeyId = env("R2_ACCESS_KEY_ID");
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
  const bucket = env("R2_BUCKET");
  const endpoint = env("R2_ENDPOINT");
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) return null;
  return { accessKeyId, secretAccessKey, bucket, endpoint };
}

export function assertSafeUserId(userId: string) {
  if (!userId || userId.includes("/") || userId.includes("\\") || userId.includes("..")) {
    throw new Error("invalid user id");
  }
}

function scopedName(userId: string, name: string) {
  assertSafeUserId(userId);
  return `${userId}/${name}`;
}

function withUserIdJson(bytes: Buffer, userId: string) {
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    return Buffer.from(JSON.stringify({ ...parsed, userId }, null, 2));
  } catch {
    return bytes;
  }
}

export function createLocalStore(root = POSTERS_DIR): ObjectStore {
  function userDir(userId: string) {
    assertSafeUserId(userId);
    return path.join(root, userId);
  }

  function listRootFiles() {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  return {
    kind: "local",
    async put(userId, name, body) {
      const dir = userDir(userId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), body);
    },
    async get(userId, name) {
      const file = path.join(userDir(userId), name);
      if (!fs.existsSync(file)) return null;
      return fs.readFileSync(file);
    },
    async listJsonNames(userId) {
      const dir = userDir(userId);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    },
    async removeUser(userId) {
      fs.rmSync(userDir(userId), { recursive: true, force: true });
    },
    async removeByPosterId(userId, posterId) {
      const dir = userDir(userId);
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(`${posterId}.`)) fs.unlinkSync(path.join(dir, name));
      }
    },
    async removeByActivityIds(userId, activityIds) {
      const unscoped = userId === "__pending__";
      const dir = unscoped ? root : userDir(userId);
      if (!fs.existsSync(dir)) return 0;
      const names = fs.readdirSync(dir);
      let removed = 0;
      for (const jsonName of names.filter((name) => name.endsWith(".json"))) {
        try {
          const record = JSON.parse(fs.readFileSync(path.join(dir, jsonName), "utf8")) as { activityId?: unknown };
          if (!activityIds.has(Number(record.activityId))) continue;
          const posterId = jsonName.slice(0, -".json".length);
          for (const name of names.filter((item) => item.startsWith(`${posterId}.`))) {
            fs.unlinkSync(path.join(dir, name));
          }
          removed += 1;
        } catch {
          // Ignore unrelated or malformed files; only verified poster records are purged.
        }
      }
      return removed;
    },
    async hasUnscopedPosters() {
      return listRootFiles().some((name) => name.endsWith(".json"));
    },
    async migrateUnscopedToUser(userId) {
      const names = listRootFiles();
      const jsonNames = names.filter((name) => name.endsWith(".json"));
      for (const jsonName of jsonNames) {
        const posterId = jsonName.slice(0, -".json".length);
        const siblings = names.filter((name) => name.startsWith(`${posterId}.`));
        for (const name of siblings) {
          const bytes = fs.readFileSync(path.join(root, name));
          const body = name.endsWith(".json") ? withUserIdJson(bytes, userId) : bytes;
          await this.put(userId, name, body, name.endsWith(".json") ? "application/json" : "image/png");
          fs.unlinkSync(path.join(root, name));
        }
      }
    },
  };
}

export function createR2Store(config: NonNullable<ReturnType<typeof r2Config>>, prefix = "posters/"): ObjectStore {
  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  async function listNames(startsWith = "") {
    const names: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: `${prefix}${startsWith}`,
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) {
        const key = item.Key ?? "";
        if (key.startsWith(prefix)) names.push(key.slice(prefix.length));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return names;
  }

  async function getRaw(name: string) {
    try {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: `${prefix}${name}`,
        }),
      );
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "NoSuchKey") {
        return null;
      }
      const status =
        error && typeof error === "object" && "$metadata" in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
          : undefined;
      if (status === 404) return null;
      throw error;
    }
  }

  async function putRaw(name: string, body: Buffer, contentType: string) {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: `${prefix}${name}`,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async function removeNames(names: string[]) {
    for (let offset = 0; offset < names.length; offset += 1000) {
      const result = await client.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: names.slice(offset, offset + 1000).map(name => ({ Key: `${prefix}${name}` })) },
      }));
      if (result.Errors?.length) throw new Error("Could not delete all stored account files. Please retry.");
    }
  }

  return {
    kind: "r2",
    async signedUrl(userId, name, expiresIn) {
      return getSignedUrl(client, new GetObjectCommand({
        Bucket: config.bucket,
        Key: `${prefix}${scopedName(userId, name)}`,
      }), { expiresIn });
    },
    async put(userId, name, body, contentType) {
      await putRaw(scopedName(userId, name), body, contentType);
    },
    async get(userId, name) {
      return getRaw(scopedName(userId, name));
    },
    async listJsonNames(userId) {
      assertSafeUserId(userId);
      const prefixName = `${userId}/`;
      return (await listNames(prefixName))
        .filter((name) => name.startsWith(prefixName) && name.endsWith(".json"))
        .map((name) => name.slice(prefixName.length));
    },
    async removeUser(userId) {
      assertSafeUserId(userId);
      await removeNames(await listNames(`${userId}/`));
    },
    async removeByPosterId(userId, posterId) {
      const names = await listNames(scopedName(userId, `${posterId}.`));
      await removeNames(names);
    },
    async removeByActivityIds(userId, activityIds) {
      const unscoped = userId === "__pending__";
      const names = unscoped
        ? (await listNames()).filter((name) => !name.includes("/"))
        : await listNames(`${userId}/`);
      const jsonNames = names.filter((name) => name.endsWith(".json"));
      let removed = 0;
      for (const jsonName of jsonNames) {
        const bytes = await getRaw(jsonName);
        if (!bytes) continue;
        try {
          const record = JSON.parse(bytes.toString("utf8")) as { activityId?: unknown };
          if (!activityIds.has(Number(record.activityId))) continue;
          const posterId = jsonName.slice(0, -".json".length);
          await removeNames(names.filter((name) => name.startsWith(`${posterId}.`)));
          removed += 1;
        } catch {
          // Ignore unrelated or malformed files; only verified poster records are purged.
        }
      }
      return removed;
    },
    async hasUnscopedPosters() {
      return (await listNames()).some((name) => name.endsWith(".json") && !name.includes("/"));
    },
    async migrateUnscopedToUser(userId) {
      const names = await listNames();
      const unscoped = names.filter((name) => !name.includes("/"));
      const jsonNames = unscoped.filter((name) => name.endsWith(".json"));
      for (const jsonName of jsonNames) {
        const posterId = jsonName.slice(0, -".json".length);
        const siblings = unscoped.filter((name) => name.startsWith(`${posterId}.`));
        for (const name of siblings) {
          const bytes = await getRaw(name);
          if (!bytes) continue;
          const body = name.endsWith(".json") ? withUserIdJson(bytes, userId) : bytes;
          await putRaw(
            scopedName(userId, name),
            body,
            name.endsWith(".json") ? "application/json" : "image/png",
          );
        }
        await removeNames(siblings);
      }
    },
  };
}

let cached: ObjectStore | null = null;

export function posterStore(): ObjectStore {
  if (cached) return cached;
  const remote = r2Config();
  cached = remote ? createR2Store(remote) : createLocalStore();
  return cached;
}

export function resetPosterStore() {
  cached = null;
}
