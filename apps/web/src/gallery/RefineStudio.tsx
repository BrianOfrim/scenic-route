import { useEffect, useMemo, useState, type ReactNode } from "react";
import { modifyPoster, type PosterRecord } from "../api";
import { posterCardSrc } from "./galleryList";
import { ReadyImage } from "./GalleryViewer";
import { lineageFamily } from "./galleryRuns";
import { ShareButton } from "../share";
import { MOBILE_QUERY, useMediaQuery } from "../useMediaQuery";
import { EditAnnotation, type AnnotationStrokes } from "./EditAnnotation";

type Props = {
  source: PosterRecord;
  posters: PosterRecord[];
  onBack: () => void;
  onPostersChange: (next: PosterRecord[] | ((current: PosterRecord[]) => PosterRecord[])) => void;
  tabs?: ReactNode;
};

function versionLabel(item: PosterRecord, originalId?: string) {
  if (item.refineNotes?.trim()) return item.refineNotes.trim();
  if (originalId && item.posterId === originalId) return "Original";
  return item.title;
}

export function RefineStudio({ source, posters, onBack, onPostersChange, tabs }: Props) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const family = useMemo(() => {
    const found = lineageFamily(posters, source.posterId);
    return found.length ? found : [source];
  }, [posters, source]);
  const original = family[0];
  const [selectedId, setSelectedId] = useState(source.posterId);
  const selected = family.find((item) => item.posterId === selectedId) ?? original ?? source;
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [annotation, setAnnotation] = useState<AnnotationStrokes>([]);

  useEffect(() => {
    setAnnotation([]);
    setMarking(false);
  }, [selected.posterId]);

  useEffect(() => {
    if (family.some((item) => item.posterId === selectedId)) return;
    setSelectedId(family[0]?.posterId ?? source.posterId);
  }, [family, selectedId, source.posterId]);


  async function handleApply() {
    const text = request.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const records = await modifyPoster({
        posterId: selected.posterId,
        activityId: selected.activityId, title: selected.title, styleId: selected.styleId, paletteId: selected.paletteId,
        request: text,
        ...(annotation.length ? { annotation } : {}),
        variants: 1,
        model: selected.model,
      });
      if (!records.length) throw new Error("Image refinement failed");
      onPostersChange((current) => {
        const seen = new Set(records.map((item) => item.posterId));
        return [...records, ...current.filter((item) => !seen.has(item.posterId))];
      });
      setSelectedId(records[0].posterId);
      setRequest("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image refinement failed");
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
        {!isMobile && tabs}
        <div className="top-actions">
          {error && (
            <p className="error banner">
              {error}
              <button type="button" className="text-btn" onClick={() => setError(null)}>
                dismiss
              </button>
            </p>
          )}
          <button type="button" className="text-btn" onClick={onBack}>
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
            <div className="edit-annotation-stage">
              <ReadyImage src={selected.url} previewSrc={selected.thumbDataUrl} alt={selected.title} />
              <EditAnnotation key={`${selected.posterId}-${marking}-${busy}`} strokes={annotation} onChange={setAnnotation} disabled={busy || !marking} />
            </div>
            <figcaption>{versionLabel(selected, original?.posterId)}</figcaption>
          </figure>
        </div>
        <div className="edit-annotation-tools">
          <button type="button" className="text-btn" aria-pressed={marking} disabled={busy} onClick={() => setMarking(!marking)}>
            {marking ? "Done marking" : "Mark an area"}
          </button>
          <button type="button" className="text-btn" disabled={busy || !annotation.length} onClick={() => setAnnotation(annotation.slice(0, -1))}>Undo mark</button>
          <button type="button" className="text-btn" disabled={busy || !annotation.length} onClick={() => setAnnotation([])}>Clear marks</button>
          <p className="muted">{marking ? "Circle or outline an area, then describe the change below." : "Optionally mark the area your edit refers to."}</p>
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
              {busy ? "Applying change…" : "Apply change"}
            </button>
            <a className="text-btn" href={selected.url} download={`${selected.posterId}.png`}>
              Download selected
            </a>
            <ShareButton url={selected.url} filename={`${selected.posterId}.png`} />
            {selected.annotationUrl && (
              <a className="text-btn" href={selected.annotationUrl} target="_blank" rel="noopener noreferrer">View saved annotation</a>
            )}
          </div>
        </form>
        <div className="subheading">Versions</div>
        <div className="refine-studio-grid">
          {family.map((poster) => (
            <button
              key={poster.posterId}
              type="button"
              className={`refine-studio-card ${poster.posterId === selected.posterId ? "on" : ""}`}
              onClick={() => setSelectedId(poster.posterId)}
              disabled={busy}
            >
              <img src={posterCardSrc(poster)} alt={poster.title} />
              <span title={versionLabel(poster, original?.posterId)}>{versionLabel(poster, original?.posterId)}</span>
            </button>
          ))}
        </div>
      </div>
      {isMobile && tabs}
    </div>
  );
}
