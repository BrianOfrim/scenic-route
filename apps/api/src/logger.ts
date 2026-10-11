import fs from "node:fs/promises";
import path from "node:path";
import { format } from "node:util";
import { DATA_DIR } from "./paths";

type LogLevel = "debug" | "info" | "warn" | "error";
type Threshold = LogLevel | "off";
export type LogRecord = Record<string, unknown> & { timestamp: string; level: LogLevel; scope: string };
const priorities: Record<Threshold, number> = { debug: 10, info: 20, warn: 30, error: 40, off: Infinity };
const threshold = (value: string | undefined, fallback: Threshold): Threshold =>
  value && Object.hasOwn(priorities, value) ? value as Threshold : fallback;
type TerminalWriters = Pick<Console, "debug" | "info" | "warn" | "error">;
let terminalWriters: TerminalWriters | undefined;

function display(level: LogLevel, scope: string, record: LogRecord) {
  const output = terminalWriters ?? console;
  if (scope === "console" && typeof record.message === "string") output[level](record.message);
  else output[level](scope, JSON.stringify(record));
}

/** Independent file and terminal thresholds; ordered asynchronous JSONL writes. */
export function createLogger(options: { directory?: string; consoleLevel?: Threshold; fileLevel?: Threshold } = {}) {
  let pending = Promise.resolve();
  let warned = false;

  function log(level: LogLevel, scope: string, fields: Record<string, unknown>): LogRecord {
    const record: LogRecord = { ...fields, timestamp: new Date().toISOString(), level, scope };
    const consoleLevel = options.consoleLevel ?? threshold(process.env.LOG_CONSOLE_LEVEL, "info");
    const fileLevel = options.fileLevel ?? threshold(process.env.LOG_FILE_LEVEL, "debug");
    if (priorities[level] >= priorities[consoleLevel]) display(level, scope, record);
    if (priorities[level] >= priorities[fileLevel]) {
      const directory = options.directory ?? (process.env.LOG_DIR?.trim() || path.join(DATA_DIR, "logs"));
      const file = path.join(directory, `api-${record.timestamp.slice(0, 10)}.jsonl`);
      const line = JSON.stringify(record) + "\n";
      pending = pending.then(async () => {
        await fs.mkdir(directory, { recursive: true });
        await fs.appendFile(file, line, { mode: 0o600 });
        warned = false;
      }).catch((error: unknown) => {
        // Logging failures must not fail a geography request or recurse into logging.
        if (!warned && priorities.warn >= priorities[consoleLevel]) display("warn", "console", {
          timestamp: new Date().toISOString(), level: "warn", scope: "console",
          message: `Structured log file write failed: ${error instanceof Error ? error.name : "unknown"}`,
        });
        warned = true;
      });
    }
    return record;
  }

  return {
    debug: (scope: string, fields: Record<string, unknown>) => log("debug", scope, fields),
    info: (scope: string, fields: Record<string, unknown>) => log("info", scope, fields),
    warn: (scope: string, fields: Record<string, unknown>) => log("warn", scope, fields),
    error: (scope: string, fields: Record<string, unknown>) => log("error", scope, fields),
    flush: () => pending,
  };
}

export const logger = createLogger();

/** Route existing application and library console messages through both sinks. */
export function installConsoleLogging(): () => void {
  if (terminalWriters) return () => {};
  const original = { log: console.log, debug: console.debug, info: console.info, warn: console.warn, error: console.error };
  terminalWriters = { debug: original.debug.bind(console), info: original.info.bind(console),
    warn: original.warn.bind(console), error: original.error.bind(console) };
  console.log = (...args: unknown[]) => { logger.info("console", { message: format(...args) }); };
  for (const level of ["debug", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => { logger[level]("console", { message: format(...args) }); };
  }
  return () => {
    Object.assign(console, original);
    terminalWriters = undefined;
  };
}
