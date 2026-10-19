import { StudioPreview, StudioThumbnail } from "./StudioImage";
import type { PosterRecord } from "../api";
import { useEffect, useRef, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { fetchPoster, fetchPosterImage, retryPosterJob, submitPosterBatch, uploadPosterReferences } from "../api";
import { createReferenceUploadCache } from "../poster/referenceUploadCache";
import { addThemeBatchVariant, advanceThemeBatch, batchKey, loadThemeBatches, saveThemeBatch, themeBatchSlots, type ThemeBatchRun } from "./themeBatch";
import "./themeBatch.css";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function webp(blob: Blob, max: number, quality: number) {
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Image conversion failed")), "image/webp", quality));
    if (result.type !== "image/webp") throw new Error("This browser does not support WebP export");
    return new Uint8Array(await result.arrayBuffer());
  } finally { image.close(); }
}

export function ThemeBatchReview({ userId, newRun, onConfigure, onActiveChange }: {
  userId: string; newRun: ThemeBatchRun | null; onConfigure: () => void; onActiveChange: (active: boolean) => void;
}) {
  const [runs, setRuns] = useState<ThemeBatchRun[]>([]);
  const [selected, setSelected] = useState("");
  const [scheduled, setScheduled] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState(false);
  const [focus, setFocus] = useState<PosterRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const stop = useRef(false);
  const busy = useRef(false);
  const commands = useRef<Array<{ extraTemplate?: number; retryTaskId?: string }>>([]);
  const requestedRetries = useRef(new Set<string>());
  const current = useRef<ThemeBatchRun | null>(null);
  const started = useRef("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; onActiveChange(false); }; }, []);
  useEffect(() => {
    let cancelled = false;
    loadThemeBatches(userId).then(items => {
      if (cancelled) return;
      setRuns(previous => [...previous, ...items.filter(item => !previous.some(r => r.id === item.id))]);
      setSelected(previous => previous || items[0]?.id || "");
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [userId]);

  function publish(run: ThemeBatchRun) {
    if (!mounted.current) return;
    setRuns(items => [structuredClone(run), ...items.filter(r => r.id !== run.id)]);
  }
  async function execute(run: ThemeBatchRun, extraTemplate?: number, retryTaskId?: string) {
    const targeted = extraTemplate !== undefined || retryTaskId !== undefined;
    if (busy.current) {
      if (!targeted || (current.current && current.current.id !== run.id)) return;
      if (retryTaskId && requestedRetries.current.has(retryTaskId)) return;
      if (retryTaskId) {
        requestedRetries.current.add(retryTaskId);
        setScheduled(ids => [...ids, retryTaskId]);
      }
      commands.current.push({ extraTemplate, retryTaskId });
      return;
    }
    busy.current = true; stop.current = false;
    commands.current = targeted ? [{ extraTemplate, retryTaskId }] : [];
    requestedRetries.current = new Set(retryTaskId ? [retryTaskId] : []);
    setScheduled(retryTaskId ? [retryTaskId] : []);
    setActive(run.id); onActiveChange(true); setError(null);
    try {
      await navigator.locks.request(`theme-batch-${userId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("A batch is running in another tab. Pause it there before continuing here.");
        current.current = (await loadThemeBatches(userId)).find(r => r.id === run.id) || run;
        const taskIds: string[] | undefined = targeted ? [] : undefined;
        const retryTaskIds: string[] = [];
        if (!targeted) setScheduled(current.current.tasks.filter(t => !t.posters?.length).map(t => t.submissionId));
        const prepare = async () => {
          const pending = commands.current.splice(0);
          if (!pending.length) return;
          for (const command of pending) {
            const task = command.extraTemplate !== undefined
              ? addThemeBatchVariant(current.current!, command.extraTemplate)
              : current.current!.tasks.find(t => t.submissionId === command.retryTaskId);
            if (!task || task.posters?.length) continue;
            if (!taskIds?.includes(task.submissionId)) taskIds?.push(task.submissionId);
            if (command.retryTaskId) {
              retryTaskIds.push(task.submissionId);
              delete task.error;
            }
            setScheduled(ids => ids.includes(task.submissionId) ? ids : [...ids, task.submissionId]);
          }
          await saveThemeBatch(current.current!);
          publish(current.current!);
        };
        const upload = createReferenceUploadCache(uploadPosterReferences);
        await advanceThemeBatch(current.current!, {
          prepare, continueOnError: true,
          taskIds, retryTaskIds, retry: retryPosterJob, upload, save: saveThemeBatch, submit: submitPosterBatch, fetchPoster,
          shouldStop: () => stop.current,
          sleep: () => new Promise(resolve => setTimeout(resolve, 3000)),
          changed: () => publish(current.current!),
        }).finally(prepare);
      });
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally {
      busy.current = false; current.current = null; commands.current = [];
      if (mounted.current) { setActive(null); setScheduled([]); onActiveChange(false); }
    }
  }

  useEffect(() => {
    if (!newRun || started.current === newRun.id) return;
    started.current = newRun.id;
    publish(newRun); setSelected(newRun.id);
    void execute(newRun);
  // A new run is an explicit request from the composer, not a render-driven restart.
  }, [newRun]);

  const run = runs.find(r => r.id === selected);
  const completed = run?.tasks.filter(t => t.posters?.length).length || 0;
  async function pick(key: string, posterId: string) {
    if (!run) return;
    try {
      const update = async (next: ThemeBatchRun) => {
        next.winners[key] = posterId;
        await saveThemeBatch(next); publish(next);
      };
      // Local selections update the runner's live object. Other tabs must acquire its lock.
      if (current.current?.id === run.id) await update(current.current);
      else await navigator.locks.request(`theme-batch-${userId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("Pause generation before picking winners in a different tab.");
        const latest = (await loadThemeBatches(userId)).find(r => r.id === run.id);
        if (latest) await update(latest);
      });
    } catch (e) { setError(String(e)); }
  }
  async function exportWinners() {
    if (!run) return;
    setExporting(true); setError(null);
    try {
      const files: Record<string, Uint8Array> = {};
      const manifest = [];
      for (const template of run.templates) {
        const key = batchKey(template);
        const id = run.winners[key];
        if (!id) throw new Error("Pick a winner for every combination before exporting");
        const name = `${template.generate.styleId}-${template.generate.paletteId}`;
        const blob = new Blob([new Uint8Array(await fetchPosterImage(id))], { type: "image/png" });
        files[`${name}.webp`] = await webp(blob, 1400, .82);
        files[`${name}-thumb.webp`] = await webp(blob, 400, .8);
        manifest.push({ styleId: template.generate.styleId, paletteId: template.generate.paletteId,
          image: `/theme-examples/martin-goodman/${name}.webp`, thumbnail: `/theme-examples/martin-goodman/${name}-thumb.webp` });
      }
      files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
      files["selections.json"] = strToU8(JSON.stringify({ runId: run.id, title: run.title, winners: run.winners }, null, 2));
      const zipped = zipSync(files, { level: 0 });
      download(new Blob([new Uint8Array(zipped)], { type: "application/zip" }), `theme-examples-${run.id}.zip`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setExporting(false); }
  }
  return <section className="theme-batch-review">
    <header><div><p className="muted">LOCAL DEVELOPMENT</p><h1>Theme example studio</h1></div>
      <button className="button" disabled={!!active} onClick={onConfigure}>Configure poster</button></header>
    <p><a href="/gallery">Open Gallery to manage accepted jobs</a></p>
    <p>Configure a poster on the map, then run all themes and palettes from its footer. Generates up to 8 images at once. You can queue more variants and retries across sections while it runs. Keep this app tab open while the batch runs. Reloaded runs can be resumed; accepted image jobs continue on the server.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="theme-batch-toolbar">
      <label>Run <select value={selected} disabled={!!active} onChange={e => setSelected(e.target.value)}>
        <option value="">Choose a run</option>{runs.map(r => <option key={r.id} value={r.id}>{r.title} · {new Date(r.createdAt).toLocaleString()}</option>)}
      </select></label>
      {run && <><span aria-live="polite">{completed}/{run.tasks.length} images · {Object.keys(run.winners).length}/{run.templates.length} winners</span>
        {active ? <button className="button" onClick={() => { stop.current = true; }}>Pause after current requests</button>
          : <button className="button" disabled={completed === run.tasks.length} onClick={() => void execute(run)}>Resume generation</button>}
        <button className="button" disabled={exporting || run.templates.some(t => !run.winners[batchKey(t)])} onClick={() => void exportWinners()}>{exporting ? "Exporting…" : "Export winners (.zip)"}</button>
        <label><input type="checkbox" checked={filter} onChange={e => setFilter(e.target.checked)} /> Unpicked only</label>
      </>}
    </div>
    {!run && <p>No batch selected. Choose “Configure poster” to start.</p>}
    {run?.templates.filter(template => !filter || !run.winners[batchKey(template)]).map((template) => {
      const key = batchKey(template);
      const index = run.templates.indexOf(template);
      const tasks = run.tasks.filter(t => t.template === index);
      const candidates = tasks.flatMap((task, index) => (task.posters || []).map(poster => ({ poster, variant: index + 1 })));
      const posters = candidates.map(candidate => candidate.poster);
      const label = themeBatchSlots().find(s => s.key === key)?.label || key;
      return <section key={key} className="theme-batch-group">
        <div className="theme-batch-group-header">
          <h2>{label} <small>{posters.length}/{tasks.length} variants</small></h2>
          <button className="button" aria-label={`Generate another variant for ${label}`}
            onClick={() => void execute(run, index)}>{active ? "Queue another variant" : "Generate another variant"}</button>
        </div>
        {!posters.length && <p className="muted">Waiting for generation</p>}
        <div className="theme-batch-grid">{candidates.map(({ poster, variant }) => <article key={poster.posterId} className={run.winners[key] === poster.posterId ? "winner" : ""}>
          <button className="theme-batch-image" onClick={() => setFocus(poster)} aria-label={`Enlarge ${label} variant ${variant}`}><StudioThumbnail userId={userId} poster={poster} alt={`${label} variant ${variant}`} /></button>
          <button className="button" aria-pressed={run.winners[key] === poster.posterId} onClick={() => void pick(key, poster.posterId)}>{run.winners[key] === poster.posterId ? "✓ Winner" : `Pick variant ${variant}`}</button>
        </article>)}
          {tasks.map((task, index) => !task.posters?.length && <article key={task.submissionId} className="theme-batch-pending">
            <strong>Variant {index + 1} {task.error ? "failed" : "not completed"}</strong>
            <p>{task.error || (active ? "Queued or generating…" : "Waiting for generation or a previous request to finish.")}</p>
            {task.retryAllowedAt && <p>Server retry available after {new Date(task.retryAllowedAt).toLocaleString()}.</p>}
            <button className="button" disabled={!!active && scheduled.includes(task.submissionId)} aria-label={`Retry variant ${index + 1} for ${label}`}
              onClick={() => void execute(run, undefined, task.submissionId)}>{active && scheduled.includes(task.submissionId) ? "Queued / generating…" : `Retry variant ${index + 1}`}</button>
          </article>)}
        </div>
      </section>;
    })}
    {focus && <StudioPreview key={focus.posterId} userId={userId} poster={focus} onClose={() => setFocus(null)} />}
  </section>;
}
