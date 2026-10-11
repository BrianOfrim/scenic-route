import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLogger, installConsoleLogging, logger } from "./logger";
import { geographyTiming, logGeographyTiming, newGeographyTiming } from "./osm/geographyTiming";

test("debug timing records reach files while the info terminal threshold hides them", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-logger-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const debug = t.mock.method(console, "debug", () => {});
  const info = t.mock.method(console, "info", () => {});
  const log = createLogger({ directory, consoleLevel: "info", fileLevel: "debug" });
  const first = log.debug("geography.timing", { event: "start", loadId: "test-load" });
  log.debug("geography.timing", { event: "complete", totalMs: 42 });
  log.info("api", { event: "ready" });
  await log.flush();
  assert.equal(debug.mock.callCount(), 0);
  assert.equal(info.mock.callCount(), 1);
  const records = (await fs.readFile(path.join(directory, `api-${first.timestamp.slice(0, 10)}.jsonl`), "utf8"))
    .trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => record.level), ["debug", "debug", "info"]);
  assert.equal(records[0].loadId, "test-load");
  assert.equal(records[1].totalMs, 42);
  assert.equal(records[0].scope, "geography.timing");
});

test("terminal and file thresholds can be configured independently", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-logger-levels-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const debug = t.mock.method(console, "debug", () => {});
  const log = createLogger({ directory, consoleLevel: "debug", fileLevel: "error" });
  log.debug("geography.timing", { event: "start" });
  await log.flush();
  assert.equal(debug.mock.callCount(), 1);
  assert.deepEqual(await fs.readdir(directory), []);
});

test("environment defaults retain actual geography events without terminal output", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-geography-log-file-"));
  const keys = ["LOG_DIR", "LOG_CONSOLE_LEVEL", "LOG_FILE_LEVEL"] as const;
  const previous = keys.map(key => process.env[key]);
  t.after(async () => {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await fs.rm(directory, { recursive: true, force: true });
  });
  process.env.LOG_DIR = directory;
  delete process.env.LOG_CONSOLE_LEVEL;
  delete process.env.LOG_FILE_LEVEL;
  const debug = t.mock.method(console, "debug", () => {});
  const info = t.mock.method(console, "info", () => {});
  const { logger } = await import("./logger");
  const context = newGeographyTiming();
  geographyTiming.run(context, () => logGeographyTiming("overpass-miss", { totalMs: 1234 }));
  await logger.flush();
  const file = (await fs.readdir(directory))[0];
  const record = JSON.parse((await fs.readFile(path.join(directory, file), "utf8")).trim());
  assert.equal(record.level, "debug");
  assert.equal(record.event, "overpass-miss");
  assert.equal(record.loadId, context.loadId);
  assert.equal(record.totalMs, 1234);
  assert.equal(debug.mock.callCount(), 0);
  assert.equal(info.mock.callCount(), 0);
});

test("file errors do not reject requests and the writer recovers", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-logger-error-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "logs");
  await fs.writeFile(directory, "not a directory");
  const warn = t.mock.method(console, "warn", () => {});
  const log = createLogger({ directory });
  log.debug("geography.timing", { event: "first" });
  log.debug("geography.timing", { event: "second" });
  await log.flush();
  assert.equal(warn.mock.callCount(), 1);
  await fs.rm(directory);
  const record = log.debug("geography.timing", { event: "recovered" });
  await log.flush();
  const body = await fs.readFile(path.join(directory, `api-${record.timestamp.slice(0, 10)}.jsonl`), "utf8");
  assert.equal(JSON.parse(body).event, "recovered");
});

test("existing console messages respect independent file and terminal levels without duplication", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-console-logging-"));
  const keys = ["LOG_DIR", "LOG_CONSOLE_LEVEL", "LOG_FILE_LEVEL"] as const;
  const previous = keys.map(key => process.env[key]);
  process.env.LOG_DIR = directory;
  process.env.LOG_CONSOLE_LEVEL = "warn";
  process.env.LOG_FILE_LEVEL = "debug";
  const shown: string[] = [];
  for (const method of ["debug", "info", "warn", "error"] as const) t.mock.method(console, method, (...args: unknown[]) => { shown.push(String(args[0])); });
  const restore = installConsoleLogging();
  t.after(async () => {
    restore();
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await fs.rm(directory, { recursive: true, force: true });
  });
  console.debug("timing %dms", 42);
  console.log("server started");
  console.info("information");
  console.warn("warning");
  console.error("failure");
  logger.debug("geography.timing", { event: "complete", totalMs: 42 });
  await logger.flush();
  assert.deepEqual(shown, ["warning", "failure"]);
  const file = (await fs.readdir(directory))[0];
  const records = (await fs.readFile(path.join(directory, file), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => record.level), ["debug", "info", "info", "warn", "error", "debug"]);
  assert.equal(records[0].message, "timing 42ms");
  assert.equal(records[1].message, "server started");
  assert.equal(records[5].scope, "geography.timing");
  process.env.LOG_FILE_LEVEL = "error";
  console.info("file-filtered info");
  console.error("retained error");
  await logger.flush();
  const filtered = (await fs.readFile(path.join(directory, file), "utf8")).trim().split("\n");
  assert.equal(filtered.length, 7);
  assert.equal(JSON.parse(filtered.at(-1)!).message, "retained error");
});
