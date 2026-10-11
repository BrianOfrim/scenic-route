import path from "node:path";
import { config } from "dotenv";
import { REPO_ROOT } from "./paths";
config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
const role = process.argv[2] || process.env.APP_ROLE || "combined";
if (!["api", "worker", "combined"].includes(role))
    throw new Error("APP_ROLE must be api, worker, or combined");
process.env.APP_ROLE = role;
process.env.DB_MIGRATIONS ??= "off";
if (process.env.NODE_ENV === "production") {
    const { r2Config } = await import("./storage");
    if (!r2Config())
        throw new Error("Production API and workers require shared R2 storage");
}
if (role === "worker") {
    const { initDb } = await import("./db");
    await initDb();
    process.env.POSTER_INDEX_ENABLED = "true";
    const { startGenerationWorker } = await import("./durableJobs");
    startGenerationWorker();
}
else {
    const { startApi } = await import("./index");
    await startApi();
}
