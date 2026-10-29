import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { emptyReview, validateReview, assessmentChanges } from "./core.mjs";

export async function createReviewServer({ dataset, htmlPath, ratingsPath }) {
  let saved = { revision: 0, review: emptyReview(dataset.id) };
  try {
    const existing = JSON.parse(await fs.readFile(ratingsPath, "utf8"));
    saved = { ...existing, review: validateReview(existing.review, dataset) };
    if (!Number.isSafeInteger(saved.revision) || saved.revision < 0)
      throw new Error("Invalid saved revision");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let writes = Promise.resolve();
  return http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${req.socket.localPort}`;
    const respond = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers.host !== new URL(origin).host)
      return respond(403, { error: "Invalid host" });
    const url = new URL(req.url, origin);
    if (req.method === "GET" && ["/", "/review.html"].includes(url.pathname)) {
      try {
        const html = await fs.readFile(htmlPath);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(html);
      } catch {
        respond(500, { error: "Cannot read review page" });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/ratings")
      return respond(200, saved);
    if (
      req.method === "GET" &&
      /^\/images\/[a-f0-9]{64}\.png$/.test(url.pathname)
    ) {
      try {
        const bytes = await fs.readFile(
          path.join(
            path.dirname(htmlPath),
            "images",
            path.basename(url.pathname),
          ),
        );
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(bytes);
      } catch {
        respond(404, { error: "Image not found" });
      }
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/ratings")
      return respond(404, { error: "Not found" });
    if (
      req.headers.origin !== origin ||
      !req.headers["content-type"]?.startsWith("application/json")
    )
      return respond(403, { error: "Same-origin JSON required" });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > Math.max(100_000, dataset.cases.length * 100_000))
          return respond(413, { error: "Ratings too large" });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const review = validateReview(body.review, dataset);
      writes = writes
        .catch(() => {})
        .then(async () => {
          if (body.revision !== saved.revision)
            return respond(409, {
              error:
                "Ratings changed in another tab. Reload before continuing.",
            });
          const everRevealedCaseIds = [
            ...new Set([
              ...(saved.everRevealedCaseIds ?? []),
              ...saved.review.previouslyRevealedCaseIds,
              ...review.previouslyRevealedCaseIds,
              ...(saved.review.revealedAt || review.revealedAt
                ? dataset.cases.map((c) => c.id)
                : []),
            ]),
          ];
          const next = {
            revision: saved.revision + 1,
            review,
            savedAt: new Date().toISOString(),
            everRevealedCaseIds,
            changes: assessmentChanges(
              saved.review,
              review,
              dataset,
              saved.everRevealedCaseIds ?? [],
            ),
          };
          await fs.mkdir(path.dirname(ratingsPath), { recursive: true });
          const historyDir = path.join(
            path.dirname(ratingsPath),
            "ratings-history",
          );
          await fs.mkdir(historyDir, { recursive: true });
          try {
            await fs.writeFile(
              path.join(
                historyDir,
                `${String(saved.revision).padStart(8, "0")}.json`,
              ),
              JSON.stringify(saved, null, 2),
              { flag: "wx" },
            );
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
          }
          await fs.writeFile(
            `${ratingsPath}.tmp`,
            JSON.stringify(next, null, 2),
          );
          await fs.rename(`${ratingsPath}.tmp`, ratingsPath);
          saved = next;
          respond(200, { revision: saved.revision });
        });
      await writes;
    } catch (error) {
      if (!res.headersSent) respond(400, { error: error.message });
    }
  });
}
