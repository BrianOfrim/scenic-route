import { useEffect, useMemo, useState } from "react";
import { deletePoster, fetchPosters, type PosterRecord } from "../api";

type Props = {
  onBack: () => void;
  onRefine: (poster: PosterRecord) => void;
};

export function Gallery({ onBack, onRefine }: Props) {
  const [posters, setPosters] = useState<PosterRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string>("all");
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

  const visible = posters.filter((item) => activityId === "all" || String(item.activityId) === activityId);
  const index = active ? visible.findIndex((item) => item.posterId === active.posterId) : -1;

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(null);
      if (event.key === "ArrowRight" && index >= 0 && index < visible.length - 1) {
        setActive(visible[index + 1]);
      }
      if (event.key === "ArrowLeft" && index > 0) setActive(visible[index - 1]);
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
              <em>{new Date(poster.createdAt).toLocaleString()}</em>
            </span>
          </button>
        ))}
        {!visible.length && <p className="muted">No posters yet.</p>}
      </div>
      {active && (
        <div className="lightbox" onClick={() => setActive(null)}>
          <div className="lightbox-inner" onClick={(event) => event.stopPropagation()}>
            <img src={active.url} alt={active.title} />
            <div className="lightbox-bar">
              <strong>{active.title}</strong>
              <span className="muted">{active.subtitle}</span>
              <div className="poster-actions">
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
