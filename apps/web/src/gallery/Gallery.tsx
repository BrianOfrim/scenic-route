import { useEffect, useMemo, useState } from "react";
import { deletePoster, fetchPosters, type PosterRecord } from "../api";
import { formatDurationMs, shortModelLabel } from "../poster/imageModels";

type Props = {
  onBack: () => void;
  onRefine: (poster: PosterRecord) => void;
};

export function Gallery({ onBack, onRefine }: Props) {
  const [posters, setPosters] = useState<PosterRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string>("all");
  const [modelId, setModelId] = useState<string>("all");
  const [batchId, setBatchId] = useState<string>("all");
  const [active, setActive] = useState<PosterRecord | null>(null);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    fetchPosters()
      .then(setPosters)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load posters"));
  }, []);

  const activities = useMemo(() => {
    const map = new Map<number, string>();
    for (const poster of posters) map.set(poster.activityId, poster.title);
    return [...map.entries()];
  }, [posters]);

  const models = useMemo(() => {
    const map = new Map<string, string>();
    for (const poster of posters) {
      if (poster.model) map.set(poster.model, shortModelLabel(poster.model, poster.modelName));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [posters]);

  const visible = posters.filter((item) => {
    if (activityId !== "all" && String(item.activityId) !== activityId) return false;
    if (modelId !== "all" && item.model !== modelId) return false;
    if (batchId !== "all" && item.batchId !== batchId) return false;
    return true;
  });
  const index = active ? visible.findIndex((item) => item.posterId === active.posterId) : -1;
  const batchSiblings = active?.batchId
    ? posters.filter((item) => item.batchId === active.batchId)
    : active
      ? [active]
      : [];

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(null);
      if (event.key === "ArrowRight" && index >= 0 && index < visible.length - 1) {
        setActive(visible[index + 1]);
      }
      if (event.key === "ArrowLeft" && index > 0) {
        setActive(visible[index - 1]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, index, visible]);

  async function handleDelete(poster: PosterRecord) {
    if (!window.confirm(`Delete “${poster.title}”?`)) return;
    await deletePoster(poster.posterId);
    setPosters((current) => current.filter((item) => item.posterId !== poster.posterId));
    setActive((current) => (current?.posterId === poster.posterId ? null : current));
  }

  return (
    <div className="gallery">
      <header className="top">
        <div>
          <p className="brand">Scenic Route</p>
          <h1>Poster gallery</h1>
        </div>
        <div className="top-actions">
          <label className="filter">
            Activity
            <select value={activityId} onChange={(event) => setActivityId(event.target.value)}>
              <option value="all">All</option>
              {activities.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              <option value="all">All</option>
              {models.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {batchId !== "all" && (
            <button type="button" className="text-btn on" onClick={() => setBatchId("all")}>
              Comparison run ×
            </button>
          )}
          <button type="button" className="text-btn" onClick={onBack}>
            Back to map
          </button>
        </div>
      </header>
      {error && <p className="error banner">{error}</p>}
      <div className="gallery-grid">
        {visible.map((poster) => (
          <button key={poster.posterId} type="button" className="gallery-card" onClick={() => setActive(poster)}>
            <img src={poster.url} alt={poster.title} />
            <span>
              <strong>{poster.title}</strong>
              <em className="gallery-model">
                {shortModelLabel(poster.model, poster.modelName)}
                {poster.durationMs != null ? ` · ${formatDurationMs(poster.durationMs)}` : ""}
              </em>
              <em>{new Date(poster.createdAt).toLocaleString()}</em>
            </span>
          </button>
        ))}
        {!visible.length && <p className="muted">No posters yet.</p>}
      </div>
      {active && (
        <div className="lightbox" onClick={() => setActive(null)}>
          <div className="lightbox-inner" onClick={(event) => event.stopPropagation()}>
            <div className="lightbox-stage">
              <img className="lightbox-hero" src={active.url} alt={active.title} />
            </div>
            {batchSiblings.length > 1 && (
              <div className="lightbox-thumbs">
                {batchSiblings.map((item) => (
                  <button
                    key={item.posterId}
                    type="button"
                    className={item.posterId === active.posterId ? "on" : ""}
                    onClick={() => setActive(item)}
                  >
                    <img src={item.url} alt={shortModelLabel(item.model, item.modelName)} />
                    <span>
                      {shortModelLabel(item.model, item.modelName)}
                      {item.durationMs != null ? ` · ${formatDurationMs(item.durationMs)}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="lightbox-bar">
              <strong>{active.title}</strong>
              <span className="muted">{active.subtitle}</span>
              <span className="gallery-model">{shortModelLabel(active.model, active.modelName)}</span>
              <div className="poster-actions">
                {active.batchId && (
                  <button
                    type="button"
                    className={`text-btn ${batchId === active.batchId ? "on" : ""}`}
                    onClick={() => {
                      setBatchId(active.batchId ?? "all");
                      setActive(null);
                    }}
                  >
                    Show this comparison
                  </button>
                )}
                <button type="button" className="text-btn" onClick={() => setShowMeta((value) => !value)}>
                  {showMeta ? "Hide details" : "Details"}
                </button>
                <a className="button" href={active.url} download={`${active.posterId}.png`}>
                  Download
                </a>
                <button type="button" className="text-btn" onClick={() => onRefine(active)}>
                  Refine this
                </button>
                <button type="button" className="text-btn" onClick={() => void handleDelete(active)}>
                  Delete
                </button>
              </div>
            </div>
            {showMeta && (
              <aside className="meta-drawer">
                <p className="muted">
                  {active.model}
                  {active.durationMs != null ? ` · ${formatDurationMs(active.durationMs)}` : ""}
                  {active.cost != null ? ` · $${active.cost.toFixed(3)}` : ""} · {active.referenceCount} refs
                </p>
                <pre>{active.prompt}</pre>
                <pre>{JSON.stringify(active.spec, null, 2)}</pre>
                <div className="preview-grid">
                  {Array.from({ length: active.referenceCount }, (_, i) => (
                    <img
                      key={i}
                      src={`/api/posters/${active.posterId}/ref-${i + 1}.png`}
                      alt={`Grounding ${i + 1}`}
                    />
                  ))}
                </div>
              </aside>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
