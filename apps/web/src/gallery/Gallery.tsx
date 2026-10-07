import { FavoriteMark } from "./FavoriteMark";
import { pollPosterJobs } from "../api";
import { forgetArrivedPoster, getArrivedEpoch, getArrivedPosters, useArrivedEpoch } from "./arrivedPosters";
import { clearFailedImage, generationPhaseLabels, useGenerationState, type PendingImage } from "./generationState";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { deletePoster, fetchActivities, fetchPoster, fetchPosterImage, fetchPosters, setPosterFavorite, variantPoster, type PosterRecord } from "../api";
import { posterVariantLabel, shortQualityLabel } from "../poster/imageModels";
import { AUTO_PALETTE_ID, paletteChoiceLabel, showsPalettePicker, styleById, styleLabel } from "../poster/styles";
import { galleryRuns, gallerySections, lineageFamily, runHeadline, sortGalleryRuns, viewerSiblings, viewerThumbStacks, type GallerySort } from "./galleryRuns";
import { posterCardSrc, refreshPosterList, unionPosters, galleryPosters, isPendingPoster, type GalleryPoster } from "./galleryList";
import { deleteGalleryImages, galleryArchive, selectedGalleryImages } from "./gallerySelection";
import { GalleryViewer, type GalleryImage } from "./GalleryViewer";
import { RefineStudio } from "./RefineStudio";
import { GalleryActionBar } from "./GalleryActionBar";
import { MOBILE_QUERY, useMediaQuery } from "../useMediaQuery";

type Props = {
  onEditSetup: (poster: PosterRecord) => void;
  account?: ReactNode;
  tabs?: ReactNode;
  /** After generate, open this poster's activity lightbox once posters load. */
  openPosterId?: string | null;
  onOpenPosterHandled?: () => void;
};

function posterPaletteLabel(item: { styleId: string; paletteId?: string }) {
  const style = styleById(item.styleId);
  if (!showsPalettePicker(style)) return null;
  return paletteChoiceLabel(style, item.paletteId ?? AUTO_PALETTE_ID);
}

function posterLabel(
  item: PosterRecord,
  siblings: PosterRecord[],
  compareStyles: boolean,
  compareQualities: boolean,
) {
  return (
    [
      compareStyles ? styleLabel(item.styleId, item.styleName ?? item.spec?.style?.name) : null,
      posterPaletteLabel(item),
      compareQualities ? shortQualityLabel(item.quality) : null,
      posterVariantLabel(item, siblings),
    ]
      .filter(Boolean)
      .join(" · ") || "result"
  );
}

function mixedStyles(posters: { styleId: string }[]) {
  return new Set(posters.map((item) => item.styleId)).size > 1;
}

function mixedQualities(posters: PosterRecord[]) {
  return new Set(posters.map((item) => item.quality ?? "")).size > 1;
}

function galleryLoadError(err: unknown) {
  if (err instanceof TypeError || !(err instanceof Error) || !err.message) return "Could not load images";
  return err.message;
}

function lineageNote(item: PosterRecord, originalId?: string) {
  if (item.refineNotes?.trim()) return item.refineNotes.trim();
  if (originalId && item.posterId === originalId) return "original";
  return "";
}


function GalleryCard({
  poster,
  title,
  lines,
  versionCount = 1,
  onOpen,
  onToggleFavorite,
  selecting = false,
  selected = false,
  selectionBusy = false,
  onToggleSelection,
}: {
  poster: PosterRecord;
  title?: string;
  lines: string[];
  versionCount?: number;
  onOpen: () => void;
  onToggleFavorite: () => void;
  selecting?: boolean;
  selected?: boolean;
  selectionBusy?: boolean;
  onToggleSelection?: () => void;
}) {
  const favorited = Boolean(poster.favorited);
  const stacked = versionCount > 1;
  return (
    <div className={`gallery-card${stacked ? " stacked" : ""}${selected ? " selected" : ""}`}>
      <button
        type="button"
        className="gallery-card-open"
        onClick={selecting ? onToggleSelection : onOpen}
        disabled={selecting && selectionBusy}
        aria-pressed={selecting ? selected : undefined}
        aria-label={stacked ? `${poster.title}, ${versionCount} versions` : undefined}
      >
        {stacked ? (
          <div className="gallery-stack">
            {versionCount > 2 ? <span className="gallery-stack-sheet a" aria-hidden="true" /> : null}
            <span className="gallery-stack-sheet b" aria-hidden="true" />
            <img src={posterCardSrc(poster)} alt="" />
            <span className="gallery-stack-count" title={`${versionCount} versions`}>
              {versionCount}
            </span>
          </div>
        ) : (
          <img src={posterCardSrc(poster)} alt={poster.title} />
        )}
        <span>
          {title ? <strong>{title}</strong> : null}
          {lines.map((line, index) => (
            <em key={line} className={index === 0 ? "gallery-image-meta" : undefined}>
              {line}
            </em>
          ))}
        </span>
      </button>
      {selecting && (
        <label className="gallery-select">
          <input type="checkbox" checked={selected} disabled={selectionBusy}
            onChange={onToggleSelection} aria-label={`Select ${poster.title}, ${styleLabel(poster.styleId)}`} />
        </label>
      )}
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

function GalleryPendingCard({ image }: { image: PendingImage }) {
  return (
    <div className="gallery-card gallery-pending" role="status" aria-label={`${image.title}: ${generationPhaseLabels[image.phase]} image`}>
      <div className="gallery-pending-image" aria-busy="true">
        <i className="spinner" aria-hidden="true" />
        <strong>{generationPhaseLabels[image.phase]}…</strong>
        {!!image.imageAttempt && image.imageAttempt > 1 && <span>Attempt {image.imageAttempt} of 3</span>}
      </div>
      <div className="gallery-pending-caption">
        <strong>{image.title}</strong>
        <p className="muted">{[
          image.styleId ? styleLabel(image.styleId) : null,
          image.styleId ? posterPaletteLabel({ styleId: image.styleId, paletteId: image.paletteId }) : null,
        ].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );
}

function GalleryRun({
  posters,
  allPosters,
  versionCount,
  onOpen,
  onToggleFavorite,
  selecting,
  selectedIds,
  selectionBusy,
  onToggleSelection,
}: {
  posters: GalleryPoster[];
  allPosters: PosterRecord[];
  versionCount: (poster: PosterRecord) => number;
  onOpen: (poster: PosterRecord) => void;
  onToggleFavorite: (poster: PosterRecord) => void;
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  selectionBusy: boolean;
  onToggleSelection: (id: string) => void;
}) {
  const headline = runHeadline(posters);
  const completed = posters.filter((poster): poster is PosterRecord => !isPendingPoster(poster));
  const styles = mixedStyles(posters);
  const qualities = mixedQualities(completed);
  const ids = new Set(posters.map((item) => item.posterId));
  const originalId = posters.find(
    (item) =>
      !(!isPendingPoster(item) && item.refineNotes?.trim() && item.previousPosterId && ids.has(item.previousPosterId)),
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
          if (isPendingPoster(poster)) return <GalleryPendingCard key={poster.posterId} image={poster.pending} />;
          const note = lineageNote(poster, originalId);
          const versions = versionCount(poster);
          return (
            <GalleryCard
              key={poster.posterId}
              poster={poster}
              versionCount={versions}
              lines={[posterLabel(poster, allPosters, styles, qualities), note].filter(Boolean)}
              onOpen={() => onOpen(poster)}
              selecting={selecting}
              selected={selectedIds.has(poster.posterId)}
              selectionBusy={selectionBusy}
              onToggleSelection={() => onToggleSelection(poster.posterId)}
              onToggleFavorite={() => onToggleFavorite(poster)}
            />
          );
        })}
      </div>
    </section>
  );
}

export function Gallery({ onEditSetup, account, tabs, openPosterId = null, onOpenPosterHandled }: Props) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const generation = useGenerationState();
  const arrivedEpoch = useArrivedEpoch();
  useEffect(() => pollPosterJobs(error => console.warn("Could not refresh generation jobs", error)), []);
  const [posters, setPosters] = useState<PosterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const postersRef = useRef(posters);
  postersRef.current = posters;
  const [error, setError] = useState<string | null>(null);
  const [studioFrom, setStudioFrom] = useState<PosterRecord | null>(null);
  const [active, setActive] = useState<PosterRecord | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<GallerySort>("generated");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAction, setSelectionAction] = useState<"download" | "delete" | null>(null);
  const [deleteProgress, setDeleteProgress] = useState({ completed: 0, total: 0 });
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const removedIds = useRef(new Set<string>());
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
    const records = getArrivedPosters<PosterRecord>();
    if (!records.length) return;
    setPosters((current) => unionPosters(current, records).filter(image => !removedIds.current.has(image.posterId)));
  }, [arrivedEpoch]);

  useEffect(() => {
    const startedEpoch = getArrivedEpoch();
    let cancelled = false;
    if (postersRef.current.length === 0 && startedEpoch === 0) setLoading(true);
    fetchPosters()
      .then((items) => {
        if (cancelled) return;
        setPosters((current) => refreshPosterList(current, items, startedEpoch, getArrivedEpoch()).filter(image => !removedIds.current.has(image.posterId)));
        setError((current) =>
          current === "Failed to fetch" || current === "Could not load images" ? null : current,
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(galleryLoadError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generation.revision]);

  useEffect(() => {
    if (!openPosterId || loading) return;
    const poster = posters.find((item) => item.posterId === openPosterId);
    if (poster) {
      setActive(poster);
    }
    onOpenPosterHandled?.();
  }, [openPosterId, loading, posters, onOpenPosterHandled]);

  const visible = useMemo(
    () => (favoritesOnly ? posters.filter((item) => item.favorited) : posters),
    [favoritesOnly, posters],
  );
  const sections = useMemo(
    () => gallerySections(sortGalleryRuns(galleryRuns(galleryPosters(visible, favoritesOnly ? [] : generation.pending)), sort, activityDates ?? new Map())),
    [visible, favoritesOnly, generation.pending, sort, activityDates],
  );
  const displayed = useMemo(() => sections.flatMap(section => section.kind === "singles" ? section.posters : section.run.posters).filter((poster): poster is PosterRecord => !isPendingPoster(poster)), [sections]);
  const selectedImages = selectedGalleryImages(displayed, selectedIds);
  const selectionBusy = selectionAction !== null;

  useEffect(() => {
    const available = new Set(displayed.map(image => image.posterId));
    setSelectedIds(current => {
      const next = new Set([...current].filter(id => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [displayed]);

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
    () => (active ? viewerSiblings(active, visible) : []),
    [active, visible],
  );
  const compareStyles = mixedStyles(activitySiblings);
  const compareQualities = mixedQualities(activitySiblings);
  const viewerStacks = useMemo<GalleryImage[][]>(() => {
    if (!active) return [];
    const originalId = original?.posterId;
    return viewerThumbStacks(activitySiblings, posters).map((stack) =>
      stack.map((item) => {
        const base = posterLabel(item, posters, compareStyles, compareQualities);
        const note = lineageNote(item, originalId);
        const stacked = stack.length > 1;
        return {
          id: item.posterId,
          favorited: Boolean(item.favorited),
          src: item.url,
          thumbSrc: posterCardSrc(item),
          previewSrc: item.thumbDataUrl,
          label: note && stacked ? `${base} · ${note}` : base,
        };
      }),
    );
  }, [active, activitySiblings, compareQualities, compareStyles, original?.posterId, posters]);

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
    setActive(poster);
  }

  function selectPoster(id: string) {
    const poster = activitySiblings.find((item) => item.posterId === id) ?? visible.find((item) => item.posterId === id);
    if (!poster) return;
    setActive(poster);

  }

  function patchPoster(posterId: string, patch: Partial<PosterRecord>) {
    setPosters((current) =>
      current.map((item) => (item.posterId === posterId ? { ...item, ...patch } : item)),
    );
    setActive((current) => (current?.posterId === posterId ? { ...current, ...patch } : current));
  }

  async function handleFavorite(poster: PosterRecord) {
    const next = !poster.favorited;
    patchPoster(poster.posterId, { favorited: next });
    try {
      const saved = await setPosterFavorite(poster.posterId, next);
      patchPoster(poster.posterId, { favorited: saved.favorited });
    } catch (err: unknown) {
      patchPoster(poster.posterId, { favorited: poster.favorited });
      setError(err instanceof Error ? err.message : "Could not update favourite");
    }
  }

  async function handleEditSetup(poster: PosterRecord) {
    try {
      onEditSetup(await fetchPoster(poster.posterId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load image setup");
    }
  }

  function handleNewVariant(poster: PosterRecord) {
    setActive(null);
    void variantPoster({
      posterId: poster.posterId,
      activityId: poster.activityId,
      model: poster.model,
      title: poster.title,
      styleId: poster.styleId,
      paletteId: poster.paletteId,
    }).catch(() => {
      /* trackGeneration publishes the error on the gallery */
    });
  }

  async function handleDelete(poster: PosterRecord) {
    if (!window.confirm(`Delete “${poster.title}”?`)) return;
    await deletePoster(poster.posterId);
    removedIds.current.add(poster.posterId);
    forgetArrivedPoster(poster.posterId);
    setPosters((current) => current.filter((item) => item.posterId !== poster.posterId));
    setActive((current) => (current?.posterId === poster.posterId ? null : current));
  }

  function toggleSelection(id: string) {
    if (selectionBusy) return;
    setSelectionNotice(null);
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDownloadSelected() {
    if (!selectedImages.length || selectionBusy) return;
    setSelectionAction("download");
    setSelectionNotice(null);
    setError(null);
    try {
      const archive = await galleryArchive(selectedImages, fetchPosterImage);
      const url = URL.createObjectURL(new Blob([new Uint8Array(archive)], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "scenic-route-images.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setSelectionNotice(`Downloaded ${selectedImages.length} images as a ZIP.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download selected images");
    } finally {
      setSelectionAction(null);
    }
  }

  async function handleDeleteSelected() {
    if (!selectedImages.length || selectionBusy) return;
    if (!window.confirm(`Delete ${selectedImages.length} selected image${selectedImages.length === 1 ? "" : "s"}? This cannot be undone. Only selected images will be deleted; other versions remain.`)) return;
    setSelectionAction("delete");
    setDeleteProgress({ completed: 0, total: selectedImages.length });
    setSelectionNotice(null);
    setError(null);
    try {
      const { deleted, failed } = await deleteGalleryImages(selectedImages, deletePoster, result => {
        setDeleteProgress({ completed: result.completed, total: result.total });
        if (!result.succeeded) return;
        removedIds.current.add(result.id);
        forgetArrivedPoster(result.id);
        setPosters(current => current.filter(image => image.posterId !== result.id));
        setActive(current => current?.posterId === result.id ? null : current);
        setSelectedIds(current => {
          const next = new Set(current);
          next.delete(result.id);
          return next;
        });
      });
      setSelectedIds(new Set(failed.map(image => image.id)));
      if (failed.length) setError(`${failed.length} image${failed.length === 1 ? "" : "s"} could not be deleted. ${failed[0].message}`);
      if (deleted.length) setSelectionNotice(`Deleted ${deleted.length} image${deleted.length === 1 ? "" : "s"}.`);
    } finally {
      setSelectionAction(null);
    }
  }

  if (studioFrom) {
    return (
      <RefineStudio
        source={studioFrom}
        posters={posters}
        onBack={() => setStudioFrom(null)}
        onPostersChange={setPosters}
        tabs={tabs}
      />
    );
  }

  const sortLabel = sort === "generated" ? "Recent Image" : "Recent Activity";
  const galleryFilters = (
    <>
      <button type="button" className={`text-btn ${selecting ? "on" : ""}`}
        disabled={selectionBusy} aria-pressed={selecting}
        aria-label={selecting ? "Done selecting" : "Select images"}
        onClick={() => { setSelecting(!selecting); setSelectedIds(new Set()); setSelectionNotice(null); }}>
        {selecting ? "Done" : "Select"}
      </button>
      <label className="gallery-sort" title={`Sort by: ${sortLabel}`}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 4v16m-4-4 4 4 4-4M14 5h6m-6 5h4m-4 5h2" />
        </svg>
        <select aria-label={`Sort by: ${sortLabel}`} value={sort} onChange={(event) => setSort(event.target.value as GallerySort)}>
          <option value="generated">Recent Image</option>
          <option value="activity" disabled={!activityDates}>Recent Activity</option>
        </select>
      </label>
      <button
        type="button"
        className={`text-btn ${favoritesOnly ? "on" : ""}`}
        aria-pressed={favoritesOnly}
        aria-label={`Favourites${favoriteCount ? ` · ${favoriteCount}` : ""}`}
        onClick={() => setFavoritesOnly((value) => !value)}
      >
        <span aria-hidden="true">{favoritesOnly ? "★" : "☆"}{favoriteCount ? ` ${favoriteCount}` : ""}</span>
      </button>
    </>
  );
  const selectionControls = (
    <>
      <strong aria-live="polite">{selectedImages.length} selected</strong>
      <button type="button" className="text-btn" disabled={selectionBusy || !displayed.length}
        onClick={() => setSelectedIds(new Set(displayed.map(image => image.posterId)))}>Select all</button>
      <button type="button" className="text-btn" disabled={selectionBusy || !selectedImages.length}
        onClick={() => setSelectedIds(new Set())}>Clear selection</button>
      <button type="button" className="button" disabled={selectionBusy || !selectedImages.length}
        onClick={() => void handleDownloadSelected()}>{selectionAction === "download" ? "Preparing ZIP…" : "Download selected"}</button>
      <button type="button" className="button" disabled={selectionBusy || !selectedImages.length}
        onClick={() => void handleDeleteSelected()}>{selectionAction === "delete" ? "Deleting…" : "Delete selected"}</button>
      {selectionAction === "delete" && <span role="status">Processed {deleteProgress.completed} of {deleteProgress.total} images</span>}
    </>
  );

  return (
    <div className="gallery">
      <header className="top">
        <div>
          <div className="brand-lockup">
            <img className="brand-mark" src="/logo/sr-path-sage.svg" alt="" width={40} height={40} />
            <div>
              <p className="brand">Scenic{isMobile ? <br /> : " "}Route</p>
            </div>
          </div>
        </div>
        {!isMobile && tabs}
        <div className="top-actions">
          {isMobile && galleryFilters}
          {account}
        </div>
      </header>
      {!isMobile && (
        <section className="gallery-toolbar" aria-label="Gallery">
          {galleryFilters}
          {selecting && (
            <div className="gallery-toolbar-selection" role="group" aria-label="Selected image actions" aria-busy={selectionBusy}>
              {selectionControls}
            </div>
          )}
        </section>
      )}
      {isMobile && selecting && (
        <section className="gallery-selection-bar" aria-label="Selected image actions" aria-busy={selectionBusy}>
          {selectionControls}
        </section>
      )}
      {selectionNotice && <p className="muted banner" role="status">{selectionNotice}</p>}
      {error && <p className="error banner">{error}</p>}
      {generation.error && <p className="error banner">{generation.error}</p>}
      <div className="gallery-runs">
        {generation.failed.length > 0 && (
          <section className="gallery-run" aria-label="Failed image requests">
            <header className="gallery-run-head"><strong>Failed images</strong></header>
            <div className="gallery-run-row">
              {generation.failed.map((image) => (
                <div key={image.id} className="gallery-card gallery-pending">
                  <div className="gallery-pending-image"><strong>Generation failed</strong></div>
                  <div className="gallery-pending-caption">
                    <strong>{image.title}</strong>
                    {image.styleId && <p className="muted">{styleLabel(image.styleId)}</p>}
                    <p role="alert">{image.error}</p>
                    <div className="poster-actions">
                      <button type="button" onClick={() => { void image.retry(); }}>Regenerate</button>
                      <button type="button" onClick={() => clearFailedImage(image.id)}>Clear</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {sections.map((section) =>
          section.kind === "singles" ? (
            <div key={`singles-${section.posters[0].posterId}`} className="gallery-grid">
              {section.posters.map((poster) => {
                if (isPendingPoster(poster)) return <GalleryPendingCard key={poster.posterId} image={poster.pending} />;
                const versions = versionCount(poster);
                return (
                  <GalleryCard
                    key={poster.posterId}
                    poster={poster}
                    title={poster.title}
                    versionCount={versions}
                    lines={[
                      [
                        styleLabel(poster.styleId, poster.styleName ?? poster.spec?.style?.name),
                        posterPaletteLabel(poster),
                        shortQualityLabel(poster.quality),
                        posterVariantLabel(poster, posters),
                      ]
                        .filter(Boolean)
                        .join(" · "),
                      poster.refineNotes?.trim() ||
                        (versions > 1
                          ? `${versions} versions`
                          : new Date(poster.createdAt).toLocaleString()),
                    ]}
                    selecting={selecting}
                    selected={selectedIds.has(poster.posterId)}
                    selectionBusy={selectionBusy}
                    onToggleSelection={() => toggleSelection(poster.posterId)}
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
              allPosters={posters}
              versionCount={versionCount}
              selecting={selecting}
              selectedIds={selectedIds}
              selectionBusy={selectionBusy}
              onToggleSelection={toggleSelection}
              onOpen={openPoster}
              onToggleFavorite={(poster) => void handleFavorite(poster)}
            />
          ),
        )}
        {loading ? (
          <p className="muted feature-query-block">
            <span className="spinner" aria-hidden="true" />
            Loading images…
          </p>
        ) : !visible.length && !generation.pending.length && !generation.failed.length ? (
          <p className="muted">{favoritesOnly ? "No favourited images yet." : "No images yet."}</p>
        ) : null}
      </div>
      {active && (
        <div className="lightbox" onClick={() => setActive(null)}>
          <div
            className="lightbox-inner"
            onClick={(event) => event.stopPropagation()}
          >
            <GalleryViewer
              stacks={viewerStacks}
              selectedId={active.posterId}
              onSelectPoster={selectPoster}
              renderActions={(image) => {
                const poster = posters.find((item) => item.posterId === image.id);
                if (!poster) return null;
                return (
                  <GalleryActionBar
                    image={image}
                    favorited={Boolean(poster.favorited)}
                    onFavorite={() => void handleFavorite(poster)}
                    onDelete={() => void handleDelete(poster)}
                    onVariant={() => handleNewVariant(poster)}
                    onRefine={() => {
                      setStudioFrom(poster);
                      setActive(null);
                    }}
                    onEdit={() => void handleEditSetup(poster)}
                  />
                );
              }}
              onClose={() => setActive(null)}
            />
            <div className="lightbox-bar">
              <div className="lightbox-bar-copy">
                <strong>{active.title}</strong>
                <span className="muted">{active.subtitle}</span>
                <span className="gallery-image-meta">
                  {[
                    styleLabel(active.styleId, active.styleName ?? active.spec?.style?.name),
                    posterPaletteLabel(active),
                    active.quality || null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>

            </div>

          </div>
        </div>
      )}
      {isMobile && tabs}
    </div>
  );
}
