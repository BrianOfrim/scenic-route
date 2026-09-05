import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "../../..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const DB_PATH = path.join(DATA_DIR, "scenic-route.sqlite");
export const POSTERS_DIR = path.join(DATA_DIR, "posters");
export const OSM_CACHE_DIR = path.join(DATA_DIR, "osm-cache");

const POSTER_ID_RE = /^[0-9]{8}T[0-9]{6}Z-[a-f0-9]+$/;

export function isSafePosterId(posterId: string) {
  return POSTER_ID_RE.test(posterId);
}

export function posterPath(posterId: string, ext: string) {
  return path.join(POSTERS_DIR, `${posterId}.${ext}`);
}
