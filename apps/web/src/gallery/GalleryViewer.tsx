import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CompareImage } from "../compare/BatchCompare";

type Props = {
  images: CompareImage[];
  selectedId: string;
  compareId: string | null;
  hint?: string;
  onSelectPoster: (id: string) => void;
  onCompare: (id: string | null) => void;
};

export function GalleryViewer({
  images,
  selectedId,
  compareId,
  hint,
  onSelectPoster,
  onCompare,
}: Props) {
  const [expanded, setExpanded] = useState<CompareImage | null>(null);
  const canCloseRef = useRef(false);
  const schematic = images.find((item) => item.id === "schematic");
  const posters = images.filter((item) => item.id !== "schematic");
  const selected = posters.find((item) => item.id === selectedId) ?? posters[0];
  const compare = compareId ? images.find((item) => item.id === compareId) : undefined;
  const split = Boolean(compare && selected && compare.id !== selected.id);

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

  function toggleSchematic() {
    onCompare(compareId === "schematic" ? null : "schematic");
  }

  const compareHint =
    hint ??
    (schematic
      ? split && compare?.id === "schematic"
        ? "Click another poster to keep the schematic beside it. Click the schematic again to return to one poster."
        : "Click the schematic to compare it with this poster."
      : undefined);

  return (
    <div className="batch-compare">
      <div className="compare-stage-wrap">
        <div className={`compare-stage ${split ? "" : "single"}`}>
          {split && compare && <ViewerPane image={compare} onExpand={() => expand(compare)} />}
          <ViewerPane image={selected} onExpand={() => expand(selected)} />
        </div>
      </div>
      <div className="lightbox-thumbs">
        {schematic && (
          <div className="lightbox-thumbs-schematic">
            <button
              type="button"
              className={compareId === "schematic" ? "on-schematic" : ""}
              onClick={toggleSchematic}
              aria-pressed={compareId === "schematic"}
              title={compareId === "schematic" ? "Hide schematic" : "Compare with schematic"}
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
              className={[
                image.id === selected.id ? "on" : "",
                image.id === compareId ? "on-left" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelectPoster(image.id)}
            >
              <img src={image.src} alt={image.label} />
              <span>{image.label}</span>
            </button>
          ))}
        </div>
      </div>
      {posters.length > 1 && (
        <div className="compare-nav">
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              const index = posters.findIndex((item) => item.id === selected.id);
              onSelectPoster(posters[(index - 1 + posters.length) % posters.length].id);
            }}
          >
            Previous
          </button>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              const index = posters.findIndex((item) => item.id === selected.id);
              onSelectPoster(posters[(index + 1) % posters.length].id);
            }}
          >
            Next
          </button>
        </div>
      )}
      {compareHint ? <p className="muted compare-hint">{compareHint}</p> : null}
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
              <div className="compare-nav">
                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const index = images.findIndex((item) => item.id === expanded.id);
                        setExpanded(images[(index - 1 + images.length) % images.length]);
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const index = images.findIndex((item) => item.id === expanded.id);
                        setExpanded(images[(index + 1) % images.length]);
                      }}
                    >
                      Next
                    </button>
                  </>
                )}
                <button type="button" className="text-btn" onClick={() => setExpanded(null)}>
                  Close
                </button>
              </div>
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
