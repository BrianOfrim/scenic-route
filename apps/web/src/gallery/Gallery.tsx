import { useEffect, useMemo, useState, type ReactNode } from "react";
import { deletePoster, fetchPosters, setPosterFavorite, type PosterRecord } from "../api";
import { type CompareImage } from "../compare/BatchCompare";
import { formatBatchCost, formatCostBreakdown, formatDurationMs, posterVariantLabel, shortModelLabel } from "../poster/imageModels";
import { styleLabel } from "../poster/styles";
import { galleryRuns, gallerySections, lineageFamily, runHeadline } from "./galleryRuns";
import { GalleryViewer } from "./GalleryViewer";
import { RefineStudio } from "./RefineStudio";
import { ShareButton } from "../share";

type Props = {
  onBack: () => void;
  onEditSetup: (poster: PosterRecord) => void;
  account?: ReactNode;
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

function uniquePosters(items: PosterRecord[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.posterId)) return false;
    seen.add(item.posterId);
    return true;
  });
}

function viewerSiblings(active: PosterRecord, posters: PosterRecord[]) {
  const family = lineageFamily(posters, active.posterId);
  const batch = active.batchId ? posters.filter((item) => item.batchId === active.batchId) : [];
  const siblings = uniquePosters([...family, ...batch]);
  if (!siblings.some((item) => item.posterId === active.posterId)) siblings.push(active);
  return siblings;
}

function lineageNote(item: PosterRecord, originalId?: string) {
  if (item.refineNotes?.trim()) return item.refineNotes.trim();
  if (originalId && item.posterId === originalId) return "original";
  if (item.previousPosterId) return "refinement";
  return "";
}

function FavoriteMark({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.8 14.7 9l5.8.9-4.2 4.1 1 5.8L12 17.2 6.7 19.8l1-5.8L3.5 9.9 9.3 9 12 3.8Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function GalleryCard({
  poster,
  title,
  lines,
  versionCount = 1,
  onOpen,
  onToggleFavorite,
}: {
  poster: PosterRecord;
  title?: string;
  lines: string[];
  versionCount?: number;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const favorited = Boolean(poster.favorited);
  const stacked = versionCount > 1;
  return (
    <div className={`gallery-card${stacked ? " stacked" : ""}`}>
      <button
        type="button"
        className="gallery-card-open"
        onClick={onOpen}
        aria-label={stacked ? `${poster.title}, ${versionCount} versions` : undefined}
      >
        {stacked ? (
          <div className="gallery-stack">
            {versionCount > 2 ? <span className="gallery-stack-sheet a" aria-hidden="true" /> : null}
            <span className="gallery-stack-sheet b" aria-hidden="true" />
            <img src={poster.url} alt="" />
            <span className="gallery-stack-count" title={`${versionCount} versions`}>
              {versionCount}
            </span>
          </div>
        ) : (
          <img src={poster.url} alt={poster.title} />
        )}
        <span>
          {title ? <strong>{title}</strong> : null}
          {lines.map((line, index) => (
            <em key={line} className={index === 0 ? "gallery-model" : undefined}>
              {line}
            </em>
          ))}
        </span>
      </button>
      <button
        type="button"
        className={`gallery-fav ${favorited ? "on" : ""}`}
        aria-pressed={favorited}
        aria-label={favorited ? "Remove from favourites" : "Add to favourites"}
        title={favorited ? "Remove from favourites" : "Add to favourites"}
        onClick={onToggleFavorite}
      >
        <FavoriteMark filled={favorited} />
      </button>
    </div>
  );
}

function GalleryRun({
  posters,
  versionCount,
  onOpen,
  onToggleFavorite,
}: {
  posters: PosterRecord[];
  versionCount: (poster: PosterRecord) => number;
  onOpen: (poster: PosterRecord) => void;
  onToggleFavorite: (poster: PosterRecord) => void;
}) {
  const headline = runHeadline(posters);
  const styles = mixedStyles(posters);
  const models = mixedModels(posters);
  const ids = new Set(posters.map((item) => item.posterId));
  const originalId = posters.find((item) => !item.previousPosterId || !ids.has(item.previousPosterId))
    ?.posterId;
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
        {posters.map((poster) => {
          const note = lineageNote(poster, originalId);
          const versions = versionCount(poster);
          return (
            <GalleryCard
              key={poster.posterId}
              poster={poster}
              versionCount={versions}
              lines={[posterLabel(poster, posters, styles, models), note].filter(Boolean)}
              onOpen={() => onOpen(poster)}
              onToggleFavorite={() => onToggleFavorite(poster)}
            />
          );
        })}
      </div>
    </section>
  );
}

export function Gallery({ onBack, onEditSetup, account }: Props) {
  const [posters, setPosters] = useState<PosterRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [studioFrom, setStudioFrom] = useState<PosterRecord | null>(null);
  const [active, setActive] = useState<PosterRecord | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    fetchPosters()
      .then(setPosters)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load posters"));
  }, []);

  const visible = useMemo(
    () => (favoritesOnly ? posters.filter((item) => item.favorited) : posters),
    [favoritesOnly, posters],
  );
  const sections = useMemo(() => gallerySections(galleryRuns(visible)), [visible]);
  const versionCount = useMemo(() => {
    return (poster: PosterRecord) => lineageFamily(posters, poster.posterId).length;
  }, [posters]);
  const favoriteCount = useMemo(() => posters.filter((item) => item.favorited).length, [posters]);
  const family = useMemo(
    () => (active ? lineageFamily(posters, active.posterId) : []),
    [active, posters],
  );
  const original = family[0];
  const batchSiblings = useMemo(
    () => (active ? viewerSiblings(active, posters) : []),
    [active, posters],
  );
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
    const originalId = original?.posterId;
    return [
      ...schematic,
      ...batchSiblings.map((item) => {
        const base = posterLabel(item, batchSiblings, compareStyles, compareModels);
        const note = lineageNote(item, originalId);
        return {
          id: item.posterId,
          src: item.url,
          label: note && family.length > 1 ? `${base} · ${note}` : base,
        };
      }),
    ];
  }, [active, batchSiblings, compareModels, compareStyles, family.length, original?.posterId]);

  useEffect(() => {
    if (compareId === "schematic" && active && active.referenceCount === 0) setCompareId(null);
  }, [active, compareId]);

  useEffect(() => {
    if (!active) return;
    const current = active;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActive(null);
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (batchSiblings.length < 2) return;
      const index = batchSiblings.findIndex((item) => item.posterId === current.posterId);
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
    setShowMeta(false);
    setActive(poster);
    const root = lineageFamily(posters, poster.posterId)[0];
    setCompareId(root && root.posterId !== poster.posterId ? root.posterId : null);
  }

  function selectPoster(id: string) {
    const poster = batchSiblings.find((item) => item.posterId === id) ?? posters.find((item) => item.posterId === id);
    if (!poster) return;
    setActive(poster);
    const root = lineageFamily(posters, poster.posterId)[0];
    setCompareId((current) => {
      if (current === "schematic") return current;
      if (root && root.posterId !== poster.posterId) return root.posterId;
      return null;
    });
  }

  function updatePoster(next: PosterRecord) {
    setPosters((current) => current.map((item) => (item.posterId === next.posterId ? next : item)));
    setActive((current) => (current?.posterId === next.posterId ? next : current));
  }

  async function handleFavorite(poster: PosterRecord) {
    const next = !poster.favorited;
    updatePoster({ ...poster, favorited: next });
    try {
      updatePoster(await setPosterFavorite(poster.posterId, next));
    } catch (err: unknown) {
      updatePoster(poster);
      setError(err instanceof Error ? err.message : "Could not update favourite");
    }
  }

  async function handleDelete(poster: PosterRecord) {
    if (!window.confirm(`Delete “${poster.title}”?`)) return;
    await deletePoster(poster.posterId);
    setPosters((current) => current.filter((item) => item.posterId !== poster.posterId));
    setActive((current) => (current?.posterId === poster.posterId ? null : current));
  }

  const selectedImage = active ? compareImages.find((item) => item.id === active.posterId) : undefined;

  if (studioFrom) {
    return (
      <RefineStudio
        source={studioFrom}
        posters={posters}
        onBack={() => setStudioFrom(null)}
        onPostersChange={setPosters}
      />
    );
  }

  return (
    <div className="gallery">
      <header className="top">
        <div>
          <p className="brand">Scenic Route</p>
          <h1>Poster gallery</h1>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={`text-btn ${favoritesOnly ? "on" : ""}`}
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            Favourites{favoriteCount ? ` · ${favoriteCount}` : ""}
          </button>
          <button type="button" className="text-btn" onClick={onBack}>
            Back to map
          </button>
          {account}
        </div>
      </header>
      {error && <p className="error banner">{error}</p>}
      <div className="gallery-runs">
        {sections.map((section) =>
          section.kind === "singles" ? (
            <div key={`singles-${section.posters[0].posterId}`} className="gallery-grid">
              {section.posters.map((poster) => {
                const versions = versionCount(poster);
                return (
                  <GalleryCard
                    key={poster.posterId}
                    poster={poster}
                    title={poster.title}
                    versionCount={versions}
                    lines={[
                      [
                        styleLabel(poster.styleId, poster.spec?.style?.name),
                        shortModelLabel(poster.model, poster.modelName),
                        poster.variant != null ? String(poster.variant) : null,
                        poster.durationMs != null ? formatDurationMs(poster.durationMs) : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                      poster.refineNotes?.trim() ||
                        (versions > 1
                          ? `${versions} versions`
                          : poster.previousPosterId
                            ? "Refinement"
                            : new Date(poster.createdAt).toLocaleString()),
                    ]}
                    onOpen={() => openPoster(poster)}
                    onToggleFavorite={() => void handleFavorite(poster)}
                  />
                );
              })}
            </div>
          ) : (
            <GalleryRun
              key={section.run.key}
              posters={section.run.posters}
              versionCount={versionCount}
              onOpen={openPoster}
              onToggleFavorite={(poster) => void handleFavorite(poster)}
            />
          ),
        )}
        {!visible.length && (
          <p className="muted">{favoritesOnly ? "No favourited posters yet." : "No posters yet."}</p>
        )}
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
              compareId={compareId}
              hint={
                compareId && compareId !== "schematic"
                  ? "Original on the left. Click another refinement to compare it, or the original to view it alone."
                  : family.length > 1 && compareId !== "schematic"
                    ? "Click a refinement to see it beside the original."
                    : undefined
              }
              onSelectPoster={selectPoster}
              onCompare={(id) => {
                if (id === "schematic") {
                  setCompareId("schematic");
                  return;
                }
                if (id == null) {
                  setCompareId(
                    original && active && original.posterId !== active.posterId ? original.posterId : null,
                  );
                  return;
                }
                setCompareId(id);
              }}
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
                {batchSiblings.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const index = batchSiblings.findIndex((item) => item.posterId === active.posterId);
                        setActive(batchSiblings[(index - 1 + batchSiblings.length) % batchSiblings.length]);
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const index = batchSiblings.findIndex((item) => item.posterId === active.posterId);
                        setActive(batchSiblings[(index + 1) % batchSiblings.length]);
                      }}
                    >
                      Next
                    </button>
                  </>
                )}
                <button type="button" className="text-btn" onClick={() => setActive(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className={`text-btn ${active.favorited ? "on" : ""}`}
                  aria-pressed={Boolean(active.favorited)}
                  onClick={() => void handleFavorite(active)}
                >
                  {active.favorited ? "Favourited" : "Favourite"}
                </button>
                <button type="button" className="text-btn" onClick={() => setShowMeta((value) => !value)}>
                  {showMeta ? "Hide details" : "Details"}
                </button>
                {selectedImage && (
                  <>
                    <a className="button" href={selectedImage.src} download={`${active.posterId}.png`}>
                      Download
                    </a>
                    <ShareButton url={selectedImage.src} filename={`${active.posterId}.png`} />
                  </>
                )}
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setStudioFrom(active);
                    setActive(null);
                  }}
                >
                  Refine image
                </button>
                <button type="button" className="text-btn" onClick={() => onEditSetup(active)}>
                  Edit setup
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
