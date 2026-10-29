import fs from "node:fs/promises";
import path from "node:path";
import { emptyAnnotations, validateAnnotations } from "./core.mjs";
export async function annotationService(dir, dataset) {
  const file = path.join(dir, "geography-annotations.json");
  let saved = { revision: 0, annotations: emptyAnnotations(dataset) };
  try {
    const old = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Number.isSafeInteger(old.revision) || old.revision < 0)
      throw new Error("Invalid annotation revision");
    saved = {
      ...old,
      annotations: validateAnnotations(old.annotations, dataset),
    };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let writes = Promise.resolve();
  return async (req, res) => {
    const respond = (code, body) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET") {
      respond(200, saved);
      return;
    }
    const origin = `http://127.0.0.1:${req.socket.localPort}`;
    if (
      req.method !== "POST" ||
      req.headers.origin !== origin ||
      !req.headers["content-type"]?.startsWith("application/json")
    ) {
      respond(403, { error: "Same-origin JSON required" });
      return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) {
          respond(413, { error: "Annotations too large" });
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()),
        annotations = validateAnnotations(body.annotations, dataset);
      writes = writes
        .catch(() => {})
        .then(async () => {
          if (body.revision !== saved.revision) {
            respond(409, {
              error:
                "Annotations changed in another tab. Export your work, then reload.",
            });
            return;
          }
          const history = path.join(dir, "annotation-history");
          await fs.mkdir(history, { recursive: true });
          try {
            await fs.writeFile(
              path.join(
                history,
                `${String(saved.revision).padStart(8, "0")}.json`,
              ),
              JSON.stringify(saved, null, 2),
              { flag: "wx" },
            );
          } catch (e) {
            if (e.code !== "EEXIST") throw e;
          }
          const next = {
            revision: saved.revision + 1,
            savedAt: new Date().toISOString(),
            annotations,
          };
          await fs.writeFile(file + ".tmp", JSON.stringify(next, null, 2));
          await fs.rename(file + ".tmp", file);
          saved = next;
          respond(200, { revision: saved.revision });
        });
      await writes;
    } catch (e) {
      if (!res.headersSent) respond(400, { error: e.message });
    }
  };
}
