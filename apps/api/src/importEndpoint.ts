import type { Handler } from "hono";
import { ImportError } from "./gpx";
import { importTrackFiles } from "./importActivity";
import { acquireImport, ImportGuardError } from "./importGuard";
import { ImportBodyLimitError, filesFromRequest } from "./importRequest";

export type ImportEnv = { Variables: { user: { id: string } } };

export function createImportHandler(dependencies = {
  acquire: acquireImport, parse: filesFromRequest, importFiles: importTrackFiles,
}): Handler<ImportEnv> {
  return async c => {
    let release: (() => void) | undefined;
    try {
      release = dependencies.acquire(c.get("user").id);
      const parsed = await dependencies.parse(c.req.raw);
      if (!parsed.files.length && !parsed.errors.length) {
        return c.json({ error: "Choose a GPX, FIT, TCX, or account export zip" }, 400);
      }
      const imported = parsed.files.length
        ? await dependencies.importFiles(c.get("user").id, parsed.files)
        : { activities: [], errors: [], skipped: 0 };
      const errors = [...parsed.errors, ...imported.errors];
      const result = { activities: imported.activities, errors, skipped: imported.skipped };
      if (!result.activities.length && !result.skipped) {
        const first = errors[0];
        return c.json(
          {
            error: first ? `${first.filename}: ${first.error}` : "Could not import file",
            errors,
            skipped: result.skipped,
          },
          400,
        );
      }
      return c.json(result);
    } catch (error) {
      if (error instanceof ImportGuardError) {
        await c.req.raw.body?.cancel().catch(() => {});
        c.header("Retry-After", String(error.retryAfter));
        return c.json({ error: error.message }, 429);
      }
      if (error instanceof ImportBodyLimitError) return c.json({ error: error.message }, 413);
      if (error instanceof ImportError) return c.json({ error: error.message }, 400);
      return c.json({ error: error instanceof Error ? error.message : "import failed" }, 400);
    } finally { release?.(); }
  };
}
