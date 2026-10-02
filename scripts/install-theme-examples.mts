/** Install a reviewed sample set. Run only after approval to share its images with app users. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POSTER_STYLES, AUTO_PALETTE_ID, stylePalettes } from "../apps/web/src/poster/styles";
import type { ThemeExample } from "../apps/web/src/poster/themeExampleCatalog";

const source = process.argv[2];
if (!source) throw new Error("Usage: npx tsx scripts/install-theme-examples.ts <reviewed sample folder>");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samples: ThemeExample[] = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8"));
if (!Array.isArray(samples) || !samples.length) throw new Error("Sample manifest is empty or invalid");
const seen = new Set<string>();
const files: string[] = [];
for (const sample of samples) {
  const style = POSTER_STYLES.find((item) => item.id === sample.styleId && item.id !== "custom");
  if (!style || ![AUTO_PALETTE_ID, ...stylePalettes(style).map((p) => p.id)].includes(sample.paletteId)) {
    throw new Error(`Unknown theme or palette: ${sample.styleId}/${sample.paletteId}`);
  }
  const key = `${sample.styleId}-${sample.paletteId}`;
  if (seen.has(key)) throw new Error(`Duplicate sample: ${key}`);
  seen.add(key);
  if (sample.image !== `/theme-examples/beltline/${key}.webp` || sample.thumbnail !== `/theme-examples/beltline/${key}-thumb.webp`) {
    throw new Error(`Unexpected sample paths: ${key}`);
  }
  for (const url of [sample.image, sample.thumbnail]) {
    const file = path.basename(url);
    await fs.access(path.join(source, file));
    files.push(file);
  }
}
for (const style of POSTER_STYLES.filter((s) => s.id !== "custom")) {
  for (const paletteId of [AUTO_PALETTE_ID, ...stylePalettes(style).map((p) => p.id)]) {
    if (!seen.has(`${style.id}-${paletteId}`)) throw new Error(`Missing sample: ${style.id}/${paletteId}`);
  }
}
const destination = path.join(root, "apps/web/public/theme-examples/beltline");
if (process.argv.includes("--check")) {
  console.log(`Validated ${samples.length} samples across ${POSTER_STYLES.filter((s) => s.id !== "custom").length} themes. No files copied.`);
  process.exit(0);
}
await fs.mkdir(destination, { recursive: true });
for (const file of files) await fs.copyFile(path.join(source, file), path.join(destination, file));
// Only the four public sample fields are copied; private generation metadata stays out of the site.
const manifest = samples.map(({ styleId, paletteId, image, thumbnail }) => ({ styleId, paletteId, image, thumbnail }));
await fs.writeFile(path.join(root, "apps/web/src/poster/themeExamples.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Installed ${samples.length} reviewed theme examples.`);
