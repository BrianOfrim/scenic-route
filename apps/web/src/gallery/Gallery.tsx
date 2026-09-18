import { useEffect, useMemo, useState, type ReactNode } from "react";
import { deletePoster, fetchActivities, fetchPosters, setPosterFavorite, type PosterRecord } from "../api";
import { type CompareImage } from "../compare/BatchCompare";
import { formatCostBreakdown, formatDurationMs, posterVariantLabel, shortModelLabel, shortQualityLabel } from "../poster/imageModels";
import { styleLabel } from "../poster/styles";
import { galleryRuns, gallerySections, lineageFamily, runHeadline, sortGalleryRuns, viewerSiblings, type GallerySort } from "./galleryRuns";
import { GalleryViewer } from "./GalleryViewer";
import { RefineStudio } from "./RefineStudio";
import { ShareButton } from "../share";

type Props = {
  onEditSetup: (poster: PosterRecord) => void;
  account?: ReactNode;
  tabs?: ReactNode;
  /** After generate, open this poster's activity/compare lightbox once posters load. */
  openPosterId?: string | null;
  onOpenPosterHandled?: () => void;
};

function posterLabel(
  item: PosterRecord,
  siblings: PosterRecord[],
  compareStyles: boolean,
  compareModels: boolean,
  compareQualities: boolean,
) {
  return (
    [
      compareStyles ? styleLabel(item.styleId, item.spec?.style?.name) : null,
      compareModels || !compareStyles ? shortModelLabel(item.model, item.modelName) : null,
      compareQualities ? shortQualityLabel(item.quality) : null,
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

function mixedQualities(posters: PosterRecord[]) {
  return new Set(posters.map((item) => item.quality ?? "")).size > 1;
}

function lineageNote(item: PosterRecord, originalId?: string) {
  if (item.refineNotes?.trim()) return item.refineNotes.trim();
  if (originalId && item.posterId === originalId) return "original";
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
  const qualities = mixedQualities(posters);
  const ids = new Set(posters.map((item) => item.posterId));
  const originalId = posters.find(
    (item) =>
      !(item.refineNotes?.trim() && item.previousPosterId && ids.has(item.previousPosterId)),
  )?.posterId;
  return (
    <section className="gallery-run">
      <header className="gallery-run-head">
        <strong>{headline.title}</strong>
        <p className="muted">
          {headline.date}
          {headline.detail ? ` · ${headline.detail}` : ""}
        </p>
      </header>
      <div
        className="gallery-run-row"
        role="region"
        aria-label={`${headline.title} images, newest first`}
        tabIndex={0}
      >
        {posters.map((poster) => {
          const note = lineageNote(poster, originalId);
          const versions = versionCount(poster);
          return (
            <GalleryCard
              key={poster.posterId}
              poster={poster}
              versionCount={versions}
              lines={[posterLabel(poster, posters, styles, models, qualities), note].filter(Boolean)}
              onOpen={() => onOpen(poster)}
              onToggleFavorite={() => onToggleFavorite(poster)}
            />
          );
        })}
      </div>
    </section>
  );
}

export function Gallery({ onEditSetup, account, tabs, openPosterId = null, onOpenPosterHandled }: Props) {
  const [posters, setPosters] = useState<PosterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studioFrom, setStudioFrom] = useState<PosterRecord | null>(null);
  const [active, setActive] = useState<PosterRecord | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<GallerySort>("generated");
  const [activityDates, setActivityDates] = useState<Map<number, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchActivities()
      .then((activities) => {
        if (!cancelled) setActivityDates(new Map(activities.map((activity) => [activity.id, activity.startDate])));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load activity dates. Sorting by activity is unavailable.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPosters()
      .then((items) => {
        if (!cancelled) setPosters(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load posters");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!openPosterId || loading) return;
    const poster = posters.find((item) => item.posterId === openPosterId);
    if (poster) {
      setShowMeta(false);
      setActive(poster);
      const root = lineageFamily(posters, poster.posterId)[0];
      setCompareId(root && root.posterId !== poster.posterId ? root.posterId : null);
    }
    onOpenPosterHandled?.();
  }, [openPosterId, loading, posters, onOpenPosterHandled]);

  const visible = useMemo(
    () => (favoritesOnly ? posters.filter((item) => item.favorited) : posters),
    [favoritesOnly, posters],
  );
  const sections = useMemo(
    () => gallerySections(sortGalleryRuns(galleryRuns(visible), sort, activityDates ?? new Map())),
    [visible, sort, activityDates],
  );
  const versionCount = useMemo(() => {
    return (poster: PosterRecord) => lineageFamily(posters, poster.posterId).length;
  }, [posters]);
  const favoriteCount = useMemo(() => posters.filter((item) => item.favorited).length, [posters]);
  const family = useMemo(
    () => (active ? lineageFamily(posters, active.posterId) : []),
    [active, posters],
  );
  const original = family[0];
  const activitySiblings = useMemo(
    () => (active ? viewerSiblings(active, posters) : []),
    [active, posters],
  );
  const compareStyles = mixedStyles(activitySiblings);
  const compareModels = mixedModels(activitySiblings);
  const compareQualities = mixedQualities(activitySiblings);
  const activeCost = active
    ? formatCostBreakdown({ promptCost: active.promptCost, cost: active.cost })
    : "";
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
      ...activitySiblings.map((item) => {
        const base = posterLabel(item, activitySiblings, compareStyles, compareModels, compareQualities);
        const note = lineageNote(item, originalId);
        return {
          id: item.posterId,
          src: item.url,
          label: note && family.length > 1 ? `${base} · ${note}` : base,
        };
      }),
    ];
  }, [active, activitySiblings, compareModels, compareQualities, compareStyles, family.length, original?.posterId]);

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
      if (activitySiblings.length < 2) return;
      const index = activitySiblings.findIndex((item) => item.posterId === current.posterId);
      if (index < 0) return;
      const next =
        event.key === "ArrowRight"
          ? activitySiblings[(index + 1) % activitySiblings.length]
          : activitySiblings[(index - 1 + activitySiblings.length) % activitySiblings.length];
      setActive(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, activitySiblings]);

  function openPoster(poster: PosterRecord) {
    setShowMeta(false);
    setActive(poster);
    const root = lineageFamily(posters, poster.posterId)[0];
    setCompareId(root && root.posterId !== poster.posterId ? root.posterId : null);
  }

  function selectPoster(id: string) {
    const poster = activitySiblings.find((item) => item.posterId === id) ?? posters.find((item) => item.posterId === id);
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
          <div className="brand-lockup">
            <img className="brand-mark" src="/logo/sr-path-sage.svg" alt="" width={40} height={40} />
            <div>
              <p className="brand">Scenic Route</p>
              <h1>Poster gallery</h1>
            </div>
          </div>
        </div>
        <div className="top-actions">
          <label className="gallery-sort">
            Sort by
            <select value={sort} onChange={(event) => setSort(event.target.value as GallerySort)}>
              <option value="generated">Most recently generated image</option>
              <option value="activity" disabled={!activityDates}>Most recent activity</option>
            </select>
          </label>
          <button
            type="button"
            className={`text-btn ${favoritesOnly ? "on" : ""}`}
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            Favourites{favoriteCount ? ` · ${favoriteCount}` : ""}
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
                        shortQualityLabel(poster.quality),
                        poster.variant != null ? String(poster.variant) : null,
                        poster.durationMs != null ? formatDurationMs(poster.durationMs) : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                      poster.refineNotes?.trim() ||
                        (versions > 1
                          ? `${versions} versions`
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
        {loading ? (
          <p className="muted feature-query-block">
            <span className="spinner" aria-hidden="true" />
            Loading posters…
          </p>
        ) : !visible.length ? (
          <p className="muted">{favoritesOnly ? "No favourited posters yet." : "No posters yet."}</p>
        ) : null}
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
                  {active.quality ? ` · ${active.quality}` : ""}
                </span>
              </div>
              <div className="poster-actions">
                {activitySiblings.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const index = activitySiblings.findIndex((item) => item.posterId === active.posterId);
                        setActive(activitySiblings[(index - 1 + activitySiblings.length) % activitySiblings.length]);
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const index = activitySiblings.findIndex((item) => item.posterId === active.posterId);
                        setActive(activitySiblings[(index + 1) % activitySiblings.length]);
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
                  Image {active.model}
                  {active.promptModel ? ` · Prompt ${active.promptModel}` : ""}
                  {active.durationMs != null ? ` · ${formatDurationMs(active.durationMs)}` : ""}
                  {activeCost ? ` · ${activeCost}` : ""} · {active.referenceCount} refs
                </p>
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
      {tabs}
    </div>
  );
}
