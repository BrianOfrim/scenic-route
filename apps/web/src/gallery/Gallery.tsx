import { useEffect, useMemo, useState } from "react";
import { deletePoster, fetchPosters, type PosterRecord } from "../api";
import { type CompareImage } from "../compare/BatchCompare";
import { formatBatchCost, formatCostBreakdown, formatDurationMs, posterVariantLabel, shortModelLabel } from "../poster/imageModels";
import { styleLabel } from "../poster/styles";
import { galleryRuns, gallerySections, runHeadline } from "./galleryRuns";
import { GalleryViewer } from "./GalleryViewer";

type Props = {
  onBack: () => void;
  onRefine: (poster: PosterRecord) => void;
};

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

function mixedStyles(posters: PosterRecord[]) {
  return new Set(posters.map((item) => item.styleId)).size > 1;
}

function mixedModels(posters: PosterRecord[]) {
  return new Set(posters.map((item) => item.model)).size > 1;
}

function GalleryCard({
  poster,
  title,
  lines,
  onOpen,
}: {
  poster: PosterRecord;
  title?: string;
  lines: string[];
  onOpen: () => void;
}) {
  return (
    <button type="button" className="gallery-card" onClick={onOpen}>
      <img src={poster.url} alt={poster.title} />
      <span>
        {title ? <strong>{title}</strong> : null}
        {lines.map((line, index) => (
          <em key={line} className={index === 0 ? "gallery-model" : undefined}>
            {line}
          </em>
        ))}
      </span>
    </button>
  );
}

function GalleryRun({
  posters,
  onOpen,
}: {
  posters: PosterRecord[];
  onOpen: (poster: PosterRecord) => void;
}) {
  const headline = runHeadline(posters);
  const styles = mixedStyles(posters);
  const models = mixedModels(posters);
  return (
    <section className="gallery-run">
      <header className="gallery-run-head">
        <strong>{headline.title}</strong>
        <p className="muted">
          {headline.date}
          {headline.detail ? ` · ${headline.detail}` : ""}
        </p>
      </header>
      <div className="gallery-run-row">
        {posters.map((poster) => (
          <GalleryCard
            key={poster.posterId}
            poster={poster}
            lines={[posterLabel(poster, posters, styles, models)]}
            onOpen={() => onOpen(poster)}
          />
        ))}
      </div>
    </section>
  );
}

export function Gallery({ onBack, onRefine }: Props) {
  const [posters, setPosters] = useState<PosterRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<PosterRecord | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [showSchematic, setShowSchematic] = useState(false);

  useEffect(() => {
    fetchPosters()
      .then(setPosters)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load posters"));
  }, []);

  const sections = useMemo(() => gallerySections(galleryRuns(posters)), [posters]);
  const batchSiblings = useMemo(() => {
    if (!active) return [];
    return active.batchId ? posters.filter((item) => item.batchId === active.batchId) : [active];
  }, [active, posters]);
  const compareStyles = mixedStyles(batchSiblings);
  const compareModels = mixedModels(batchSiblings);
  const activeCost = active
    ? formatCostBreakdown({ promptCost: active.promptCost, cost: active.cost })
    : "";
  const batchCost = batchSiblings.length > 1 ? formatBatchCost(batchSiblings) : "";
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
    if (showSchematic && active && active.referenceCount === 0) setShowSchematic(false);
  }, [active, showSchematic]);

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActive(null);
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (batchSiblings.length < 2) return;
      const index = batchSiblings.findIndex((item) => item.posterId === active.posterId);
      if (index < 0) return;
      const next =
        event.key === "ArrowRight"
          ? batchSiblings[(index + 1) % batchSiblings.length]
          : batchSiblings[(index - 1 + batchSiblings.length) % batchSiblings.length];
      setActive(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, batchSiblings]);

  function openPoster(poster: PosterRecord) {
    setShowSchematic(false);
    setShowMeta(false);
    setActive(poster);
  }

  function selectPoster(id: string) {
    const poster = batchSiblings.find((item) => item.posterId === id);
    if (poster) setActive(poster);
  }

  async function handleDelete(poster: PosterRecord) {
    if (!window.confirm(`Delete “${poster.title}”?`)) return;
    await deletePoster(poster.posterId);
    setPosters((current) => current.filter((item) => item.posterId !== poster.posterId));
    setActive((current) => (current?.posterId === poster.posterId ? null : current));
  }

  const selectedImage = active ? compareImages.find((item) => item.id === active.posterId) : undefined;

  return (
    <div className="gallery">
      <header className="top">
        <div>
          <p className="brand">Scenic Route</p>
          <h1>Poster gallery</h1>
        </div>
        <div className="top-actions">
          <button type="button" className="text-btn" onClick={onBack}>
            Back to map
          </button>
        </div>
      </header>
      {error && <p className="error banner">{error}</p>}
      <div className="gallery-runs">
        {sections.map((section) =>
          section.kind === "singles" ? (
            <div key={`singles-${section.posters[0].posterId}`} className="gallery-grid">
              {section.posters.map((poster) => (
                <GalleryCard
                  key={poster.posterId}
                  poster={poster}
                  title={poster.title}
                  lines={[
                    [
                      styleLabel(poster.styleId, poster.spec?.style?.name),
                      shortModelLabel(poster.model, poster.modelName),
                      poster.variant != null ? String(poster.variant) : null,
                      poster.durationMs != null ? formatDurationMs(poster.durationMs) : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    new Date(poster.createdAt).toLocaleString(),
                  ]}
                  onOpen={() => openPoster(poster)}
                />
              ))}
            </div>
          ) : (
            <GalleryRun
              key={section.run.key}
              posters={section.run.posters}
              onOpen={openPoster}
            />
          ),
        )}
        {!posters.length && <p className="muted">No posters yet.</p>}
      </div>
      {active && (
        <div className="lightbox" onClick={() => setActive(null)}>
          <div
            className={`lightbox-inner ${showMeta ? "with-meta" : ""}`}
            onClick={(event) => event.stopPropagation()}
          >
            <GalleryViewer
              images={compareImages}
              selectedId={active.posterId}
              showSchematic={showSchematic}
              onSelectPoster={selectPoster}
              onToggleSchematic={() => setShowSchematic((value) => !value)}
            />
            <div className="lightbox-bar">
              <div className="lightbox-bar-copy">
                <strong>{active.title}</strong>
                <span className="muted">{active.subtitle}</span>
                <span className="gallery-model">
                  {styleLabel(active.styleId, active.spec?.style?.name)}
                  {` · ${shortModelLabel(active.model, active.modelName)}`}
                </span>
              </div>
              <div className="poster-actions">
                <button type="button" className="text-btn" onClick={() => setActive(null)}>
                  Close
                </button>
                <button type="button" className="text-btn" onClick={() => setShowMeta((value) => !value)}>
                  {showMeta ? "Hide details" : "Details"}
                </button>
                {selectedImage && (
                  <a className="button" href={selectedImage.src} download={`${active.posterId}.png`}>
                    Download
                  </a>
                )}
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
                <div className="eyebrow">Details</div>
                <p className="muted">
                  {active.model}
                  {active.durationMs != null ? ` · ${formatDurationMs(active.durationMs)}` : ""}
                  {activeCost ? ` · ${activeCost}` : ""} · {active.referenceCount} refs
                </p>
                {batchCost ? <p className="muted">{batchCost}</p> : null}
                <pre>{active.prompt}</pre>
                <pre>{JSON.stringify(active.spec, null, 2)}</pre>
                {active.referenceCount > 0 && (
                  <div className="preview-grid">
                    {Array.from({ length: active.referenceCount }, (_, i) => (
                      <img
                        key={i}
                        src={`/api/posters/${active.posterId}/ref-${i + 1}.png`}
                        alt={`Grounding ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </aside>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
