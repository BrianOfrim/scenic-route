import { useEffect, useMemo, useState } from "react";
import { deletePoster, fetchPosters, type PosterRecord } from "../api";
import { BatchCompare, defaultComparePair, type CompareImage } from "../compare/BatchCompare";
import { formatDurationMs, posterVariantLabel, shortModelLabel } from "../poster/imageModels";
import { styleLabel } from "../poster/styles";

type Props = {
  onBack: () => void;
  onRefine: (poster: PosterRecord) => void;
};

type Side = "left" | "right";

function posterLabel(
  item: PosterRecord,
  siblings: PosterRecord[],
  compareStyles: boolean,
  compareModels: boolean,
) {
  return (
    [
      compareStyles ? styleLabel(item.styleId, item.spec?.style?.name) : null,
      compareModels || !compareStyles ? shortModelLabel(item.model, item.modelName) : null,
      posterVariantLabel(item, siblings),
      item.durationMs != null ? formatDurationMs(item.durationMs) : null,
    ]
      .filter(Boolean)
      .join(" · ") || "result"
  );
}

export function Gallery({ onBack, onRefine }: Props) {
  const [posters, setPosters] = useState<PosterRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string>("all");
  const [modelId, setModelId] = useState<string>("all");
  const [batchId, setBatchId] = useState<string>("all");
  const [active, setActive] = useState<PosterRecord | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [focus, setFocus] = useState<Side>("right");

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
  const batchSiblings = useMemo(() => {
    if (!active) return [];
    return active.batchId ? posters.filter((item) => item.batchId === active.batchId) : [active];
  }, [active, posters]);
  const compareStyles = new Set(batchSiblings.map((item) => item.styleId)).size > 1;
  const compareModels = new Set(batchSiblings.map((item) => item.model)).size > 1;
  const compareImages = useMemo<CompareImage[]>(() => {
    if (!active) return [];
    const schematic =
      active.referenceCount > 0
        ? [
            {
              id: "schematic",
              src: `/api/posters/${active.posterId}/ref-1.png`,
              label: "schematic",
            },
          ]
        : [];
    return [
      ...schematic,
      ...batchSiblings.map((item) => ({
        id: item.posterId,
        src: item.url,
        label: posterLabel(item, batchSiblings, compareStyles, compareModels),
      })),
    ];
  }, [active, batchSiblings, compareModels, compareStyles]);

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActive(null);
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const ids = compareImages.map((item) => item.id);
      const current = focus === "left" ? leftId : rightId;
      const index = ids.indexOf(current);
      if (index < 0 || ids.length < 2) return;
      const next =
        event.key === "ArrowRight"
          ? ids[(index + 1) % ids.length]
          : ids[(index - 1 + ids.length) % ids.length];
      if (focus === "left") setLeftId(next);
      else setRightId(next);
      if (next !== "schematic") {
        const poster = batchSiblings.find((item) => item.posterId === next);
        if (poster) setActive(poster);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, batchSiblings, compareImages, focus, leftId, rightId]);

  function openPoster(poster: PosterRecord) {
    const siblings = poster.batchId
      ? posters.filter((item) => item.batchId === poster.batchId)
      : [poster];
    const images: CompareImage[] = [
      ...(poster.referenceCount > 0
        ? [{ id: "schematic", src: `/api/posters/${poster.posterId}/ref-1.png`, label: "schematic" }]
        : []),
      ...siblings.map((item) => ({ id: item.posterId, src: item.url, label: item.posterId })),
    ];
    const pair = defaultComparePair(images, poster.posterId);
    setLeftId(pair.leftId);
    setRightId(pair.rightId);
    setFocus("right");
    setShowMeta(false);
    setActive(poster);
  }

  function assignCompare(id: string) {
    if (focus === "left") setLeftId(id);
    else setRightId(id);
    if (id === "schematic") return;
    const poster = batchSiblings.find((item) => item.posterId === id);
    if (poster) setActive(poster);
  }

  async function handleDelete(poster: PosterRecord) {
    if (!window.confirm(`Delete “${poster.title}”?`)) return;
    await deletePoster(poster.posterId);
    setPosters((current) => current.filter((item) => item.posterId !== poster.posterId));
    setActive((current) => (current?.posterId === poster.posterId ? null : current));
  }

  const focusedId = focus === "left" ? leftId : rightId;
  const focusedImage = compareImages.find((item) => item.id === focusedId);
  const focusedPoster =
    focusedId === "schematic" ? active : (batchSiblings.find((item) => item.posterId === focusedId) ?? active);

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
          <button
            key={poster.posterId}
            type="button"
            className="gallery-card"
            onClick={() => openPoster(poster)}
          >
            <img src={poster.url} alt={poster.title} />
            <span>
              <strong>{poster.title}</strong>
              <em className="gallery-model">
                {styleLabel(poster.styleId, poster.spec?.style?.name)}
                {` · ${shortModelLabel(poster.model, poster.modelName)}`}
                {poster.variant != null ? ` · ${poster.variant}` : ""}
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
            <BatchCompare
              images={compareImages}
              leftId={leftId}
              rightId={rightId}
              focus={focus}
              onFocus={setFocus}
              onSelect={assignCompare}
              onSwap={() => {
                setLeftId(rightId);
                setRightId(leftId);
              }}
            />
            <div className="lightbox-bar">
              <strong>{active.title}</strong>
              <span className="muted">{active.subtitle}</span>
              <span className="gallery-model">
                {styleLabel(active.styleId, active.spec?.style?.name)}
                {` · ${shortModelLabel(active.model, active.modelName)}`}
              </span>
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
                {focusedImage && (
                  <a
                    className="button"
                    href={focusedImage.src}
                    download={`${focusedId === "schematic" ? `${active.posterId}-schematic` : focusedId}.png`}
                  >
                    Download {focus === "left" ? "left" : "right"}
                  </a>
                )}
                {focusedPoster && (
                  <button type="button" className="text-btn" onClick={() => onRefine(focusedPoster)}>
                    Refine this
                  </button>
                )}
                {focusedPoster && focusedId !== "schematic" && (
                  <button type="button" className="text-btn" onClick={() => void handleDelete(focusedPoster)}>
                    Delete
                  </button>
                )}
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
