import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { parseArgs } from "node:util";
import { annotationDataset } from "./poster-annotations/core.mjs";
import { annotationService } from "./poster-annotations/server.mjs";
const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    port: { type: "string", default: "8794" },
  },
});
if (!values.dir) throw new Error("Provide --dir comparison-report-directory");
const dir = path.resolve(values.dir),
  port = Number(values.port);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid port");
const annotations = await annotationService(
  dir,
  annotationDataset(
    JSON.parse(await fs.readFile(path.join(dir, "comparison.json"), "utf8")),
  ),
);
const server = http.createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}`) {
    res.writeHead(403);
    res.end();
    return;
  }
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (pathname === "/annotations") return annotations(req, res);
  if (req.method !== "GET") {
    res.writeHead(403);
    res.end();
    return;
  }
  const file = pathname === "/" ? "report.html" : pathname.slice(1);
  if (
    ![
      "report.html",
      "annotate.html",
      "teaching.html",
      "teaching-set.json",
      "prompts.html",
      "candidate-prompt.txt",
      "prompt-versions.json",
      "fewshot-system-prompt.txt",
      "comparison.json",
      "prompt.txt",
    ].includes(file) &&
    !/^images\/[a-f0-9]{64}\.png$/.test(file)
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const bytes = await fs.readFile(path.join(dir, file));
    res.writeHead(200, {
      "Content-Type": file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : file.endsWith(".png")
          ? "image/png"
          : file.endsWith(".json")
            ? "application/json"
            : "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Comparison: http://127.0.0.1:${port}/report.html`),
);
