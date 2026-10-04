import { ServerResponse } from "node:http";
import { createLogger, type ProxyOptions } from "vite";

/** Keep API startup/restarts readable without hiding unexpected proxy errors. */
export function devApiProxy(target = "http://127.0.0.1:8790") {
  const logger = createLogger();
  const logError = logger.error.bind(logger);
  const handledErrors = new WeakSet<object>();
  let unavailable = false;
  logger.error = (message, options) => {
    if (options?.error && handledErrors.has(options.error)) return;
    logError(message, options);
  };
  const proxy: ProxyOptions = {
    target,
    changeOrigin: true,
    timeout: 0,
    proxyTimeout: 0,
    configure(server) {
      server.on("error", (error, _request, response) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (!["ECONNREFUSED", "ECONNRESET"].includes(code ?? "")
          || !(response instanceof ServerResponse) || response.headersSent || response.writableEnded) return;
        handledErrors.add(error);
        if (!unavailable) {
          unavailable = true;
          logger.warn(`API unavailable at ${target}; it may be starting or restarting. If this persists, check the API process.`, { timestamp: true });
        }
        response.writeHead(503, { "Content-Type": "application/json", "Retry-After": "3" });
        response.end(JSON.stringify({ error: "API is temporarily unavailable. Please try again shortly." }));
      });
      server.on("proxyRes", () => {
        if (!unavailable) return;
        unavailable = false;
        logger.info("API connection restored.", { timestamp: true });
      });
    },
  };
  return { logger, proxy };
}
