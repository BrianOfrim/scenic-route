import { useEffect, useMemo, useState } from "react";
import { modifyPoster, type PosterRecord } from "../api";
import { lineageFamily } from "./galleryRuns";
import { ShareButton } from "../share";

type Props = {
  source: PosterRecord;
  posters: PosterRecord[];
  onBack: () => void;
  onPostersChange: (next: PosterRecord[] | ((current: PosterRecord[]) => PosterRecord[])) => void;
};

function versionLabel(item: PosterRecord, originalId?: string) {
  if (item.refineNotes?.trim()) return item.refineNotes.trim();
  if (originalId && item.posterId === originalId) return "Original";
  return item.title;
}

export function RefineStudio({ source, posters, onBack, onPostersChange }: Props) {
  const family = useMemo(() => {
    const found = lineageFamily(posters, source.posterId);
    return found.length ? found : [source];
  }, [posters, source]);
  const original = family[0];
  const [selectedId, setSelectedId] = useState(source.posterId);
  const selected = family.find((item) => item.posterId === selectedId) ?? original ?? source;
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (family.some((item) => item.posterId === selectedId)) return;
    setSelectedId(family[0]?.posterId ?? source.posterId);
  }, [family, selectedId, source.posterId]);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [busy]);

  async function handleApply() {
    const text = request.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const records = await modifyPoster({
        posterId: selected.posterId,
        request: text,
        variants: 1,
        model: selected.model,
      });
      if (!records.length) throw new Error("Poster refinement failed");
      onPostersChange((current) => {
        const seen = new Set(records.map((item) => item.posterId));
        return [...records, ...current.filter((item) => !seen.has(item.posterId))];
      });
      setSelectedId(records[0].posterId);
      setRequest("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Poster refinement failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gallery refine-studio">
      <header className="top">
        <div>
          <p className="brand">Scenic Route</p>
          <h1>Refine image</h1>
        </div>
        <div className="top-actions">
          {error && (
            <p className="error banner">
              {error}
              <button type="button" className="text-btn" onClick={() => setError(null)}>
                dismiss
              </button>
            </p>
          )}
          <button type="button" className="text-btn" onClick={onBack} disabled={busy}>
            Back to gallery
          </button>
        </div>
      </header>
      <div className="refine-studio-body">
        <p className="muted">
          {selected.title}
          {selected.subtitle ? ` · ${selected.subtitle}` : ""}
        </p>
        <div className="refine-studio-stage single">
          <figure>
            <img src={selected.url} alt={selected.title} />
            <figcaption>{versionLabel(selected, original?.posterId)}</figcaption>
          </figure>
        </div>
        <form
          className="refine-studio-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void handleApply();
          }}
        >
          <label className="poster-field">
            Describe a change to the selected version
            <textarea
              className="poster-prompt"
              rows={3}
              placeholder="Brighter trail, bigger title, warmer paper…"
              value={request}
              disabled={busy}
              onChange={(event) => setRequest(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handleApply();
                }
              }}
            />
          </label>
          <div className="poster-actions">
            <button className="button" type="submit" disabled={busy || !request.trim()}>
              {busy ? `Applying change… ${elapsed}s` : "Apply change"}
            </button>
            <a className="text-btn" href={selected.url} download={`${selected.posterId}.png`}>
              Download selected
            </a>
            <ShareButton url={selected.url} filename={`${selected.posterId}.png`} />
          </div>
        </form>
        <div className="eyebrow">Versions</div>
        <div className="refine-studio-grid">
          {family.map((poster) => (
            <button
              key={poster.posterId}
              type="button"
              className={`refine-studio-card ${poster.posterId === selected.posterId ? "on" : ""}`}
              onClick={() => setSelectedId(poster.posterId)}
              disabled={busy}
            >
              <img src={poster.url} alt={poster.title} />
              <span>{versionLabel(poster, original?.posterId)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
