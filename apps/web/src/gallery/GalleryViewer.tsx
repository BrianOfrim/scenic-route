import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export type GalleryImage = {
  id: string;
  src: string;
  label: string;
};

type Props = {
  images: GalleryImage[];
  selectedId: string;
  onSelectPoster: (id: string) => void;
};

export function GalleryViewer({
  images,
  selectedId,
  onSelectPoster,
}: Props) {
  const [expanded, setExpanded] = useState<GalleryImage | null>(null);
  const canCloseRef = useRef(false);
  const selected = images.find((item) => item.id === selectedId) ?? images[0];

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

  function expand(image: GalleryImage) {
    canCloseRef.current = false;
    setExpanded(image);
  }

  return (
    <div className="batch-compare">
      <div className="compare-stage-wrap">
        <div className="compare-stage single">
          <ViewerPane image={selected} onExpand={() => expand(selected)} />
        </div>
      </div>
      <div className="lightbox-thumbs">
        <div className="lightbox-thumbs-posters">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              className={image.id === selected.id ? "on" : ""}
              aria-pressed={image.id === selected.id}
              onClick={() => onSelectPoster(image.id)}
            >
              <img src={image.src} alt={image.label} />
              <span>{image.label}</span>
            </button>
          ))}
        </div>
      </div>
      {images.length > 1 && (
        <div className="compare-nav">
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              const index = images.findIndex((item) => item.id === selected.id);
              onSelectPoster(images[(index - 1 + images.length) % images.length].id);
            }}
          >
            Previous
          </button>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              const index = images.findIndex((item) => item.id === selected.id);
              onSelectPoster(images[(index + 1) % images.length].id);
            }}
          >
            Next
          </button>
        </div>
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

function ViewerPane({ image, onExpand }: { image: GalleryImage; onExpand: () => void }) {
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
