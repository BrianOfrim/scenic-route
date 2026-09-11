import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CompareImage } from "../compare/BatchCompare";

type Props = {
  images: CompareImage[];
  selectedId: string;
  showSchematic: boolean;
  onSelectPoster: (id: string) => void;
  onToggleSchematic: () => void;
};

export function GalleryViewer({
  images,
  selectedId,
  showSchematic,
  onSelectPoster,
  onToggleSchematic,
}: Props) {
  const [expanded, setExpanded] = useState<CompareImage | null>(null);
  const canCloseRef = useRef(false);
  const schematic = images.find((item) => item.id === "schematic");
  const posters = images.filter((item) => item.id !== "schematic");
  const selected = posters.find((item) => item.id === selectedId) ?? posters[0];
  const split = Boolean(showSchematic && schematic && selected);

  useEffect(() => {
    if (!expanded) return;
    const still = images.find((item) => item.id === expanded.id);
    if (!still) {
      setExpanded(null);
      return;
    }
    if (still.src !== expanded.src || still.label !== expanded.label) setExpanded(still);
  }, [expanded, images]);

  useEffect(() => {
    if (!expanded) {
      canCloseRef.current = false;
      return;
    }
    const enable = () => {
      window.setTimeout(() => {
        canCloseRef.current = true;
      }, 0);
    };
    window.addEventListener("pointerup", enable, { once: true });
    window.addEventListener("mouseup", enable, { once: true });
    return () => {
      window.removeEventListener("pointerup", enable);
      window.removeEventListener("mouseup", enable);
    };
  }, [expanded]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(null);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded]);

  if (!selected) return null;

  function expand(image: CompareImage) {
    canCloseRef.current = false;
    setExpanded(image);
  }

  return (
    <div className="batch-compare">
      <div className="compare-stage-wrap">
        <div className={`compare-stage ${split ? "" : "single"}`}>
          {split && schematic && (
            <ViewerPane image={schematic} onExpand={() => expand(schematic)} />
          )}
          <ViewerPane image={selected} onExpand={() => expand(selected)} />
        </div>
      </div>
      <div className="lightbox-thumbs">
        {schematic && (
          <div className="lightbox-thumbs-schematic">
            <button
              type="button"
              className={split ? "on-schematic" : ""}
              onClick={onToggleSchematic}
              aria-pressed={split}
              title={split ? "Hide schematic" : "Compare with schematic"}
            >
              <img src={schematic.src} alt={schematic.label} />
              <span>{schematic.label}</span>
            </button>
          </div>
        )}
        <div className="lightbox-thumbs-posters">
          {posters.map((image) => (
            <button
              key={image.id}
              type="button"
              className={image.id === selected.id ? "on" : ""}
              onClick={() => onSelectPoster(image.id)}
            >
              <img src={image.src} alt={image.label} />
              <span>{image.label}</span>
            </button>
          ))}
        </div>
      </div>
      {schematic && (
        <p className="muted compare-hint">
          {split
            ? "Click another poster to keep the schematic beside it. Click the schematic again to return to one poster."
            : "Click the schematic to compare it with this poster."}
        </p>
      )}
      {expanded &&
        createPortal(
          <div
            className="compare-fullscreen"
            onClick={(event) => {
              if (event.target !== event.currentTarget || !canCloseRef.current) return;
              setExpanded(null);
            }}
            role="dialog"
            aria-modal="true"
            aria-label={expanded.label}
          >
            <img src={expanded.src} alt={expanded.label} onClick={(event) => event.stopPropagation()} />
            <div className="compare-fullscreen-bar" onClick={(event) => event.stopPropagation()}>
              <strong>{expanded.label}</strong>
              <button type="button" className="text-btn" onClick={() => setExpanded(null)}>
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ViewerPane({ image, onExpand }: { image: CompareImage; onExpand: () => void }) {
  return (
    <div className="compare-pane">
      <div className="compare-pane-hit">
        <img src={image.src} alt={image.label} />
        <span className="compare-caption">{image.label}</span>
      </div>
      <button
        type="button"
        className="compare-expand"
        title="View full screen"
        aria-label={`View ${image.label} full screen`}
        onClick={onExpand}
      >
        Full screen
      </button>
    </div>
  );
}
