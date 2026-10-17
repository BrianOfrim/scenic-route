import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { FullscreenZoom } from "./FullscreenZoom";
export type GalleryImage = {
  id: string;
  src: string;
  thumbSrc?: string;
  /** Inline preview that can paint before `src` is fetched. */
  previewSrc?: string;
  label: string;
  favorited: boolean;
};

type Props = {
  stacks: GalleryImage[][];
  selectedId: string;
  onSelectPoster: (id: string) => void;
  onClose: () => void;
  renderActions: (image: GalleryImage) => ReactNode;
};

const STACK_PEEK_PX = 52;
const STACK_OPEN_PX = 96;

export function GalleryViewer({
  stacks,
  selectedId,
  onSelectPoster,
  onClose,
  renderActions,
}: Props) {
  const images = stacks.flat();
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
    <div className="gallery-viewer">
      <div className="gallery-viewer-stage-wrap">
        <div className="gallery-viewer-stage">
          <ViewerPane image={selected} onExpand={() => expand(selected)} />
        </div>
        <ViewerControls
          onClose={onClose}
          onNavigate={images.length > 1 ? (direction) => {
            const index = images.findIndex((item) => item.id === selected.id);
            onSelectPoster(images[(index + direction + images.length) % images.length].id);
          } : undefined}
        />
        {renderActions(selected)}
      </div>
      <div className="lightbox-thumbs">
        <div className="lightbox-thumbs-posters">
          {stacks.map((stack) => {
            const newest = stack[0];
            const selectedInStack = stack.find((image) => image.id === selected.id);
            const caption = selectedInStack ?? newest;
            if (!newest || !caption) return null;
            const depth = Math.max(0, stack.length - 1);
            return (
              <div
                key={newest.id}
                className="lightbox-thumb-stack"
                style={{
                  ["--stack-rest" as string]: `${88 + depth * STACK_PEEK_PX}px`,
                  ["--stack-open" as string]: `${88 + depth * STACK_OPEN_PX}px`,
                }}
              >
                {stack.map((image, index) => {
                  const buried = index > 0;
                  return (
                    <button
                      key={image.id}
                      type="button"
                      className={`${image.id === selected.id ? "on" : ""}${buried ? " is-older" : ""}`.trim()}
                      aria-pressed={image.id === selected.id}
                      aria-label={buried ? `Older version: ${image.label}` : image.label}
                      title={buried ? `Older version: ${image.label}` : image.label}
                      style={{
                        ["--thumb-left" as string]: `${index * STACK_PEEK_PX}px`,
                        ["--thumb-left-open" as string]: `${index * STACK_OPEN_PX}px`,
                        zIndex: stack.length - index,
                      }}
                      onClick={() => onSelectPoster(image.id)}
                    >
                      {buried ? <span className="lightbox-thumb-older-tab">Older</span> : null}
                      <img src={image.thumbSrc || image.src} alt="" />
                    </button>
                  );
                })}
                <span
                  className="lightbox-thumb-caption"
                  style={{
                    ["--thumb-left" as string]: "0px",
                    ["--thumb-left-open" as string]: "0px",
                  }}
                >
                  {caption.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {expanded &&
        createPortal(
          <div
            className="gallery-fullscreen"
            onClick={(event) => {
              if (event.target !== event.currentTarget || !canCloseRef.current) return;
              setExpanded(null);
            }}
            role="dialog"
            aria-modal="true"
            aria-label={expanded.label}
          >
            <div className="gallery-viewer-stage-wrap">
              <FullscreenZoom key={expanded.id}>
                <ReadyImage
                  src={expanded.src}
                  previewSrc={expanded.previewSrc || expanded.thumbSrc}
                  alt={expanded.label}
                  onClick={(event) => event.stopPropagation()}
                />
              </FullscreenZoom>
              <ViewerControls
                onClose={() => setExpanded(null)}
                onNavigate={images.length > 1 ? (direction) => {
                  const index = images.findIndex((item) => item.id === expanded.id);
                  setExpanded(images[(index + direction + images.length) % images.length]);
                } : undefined}
              />
            </div>
            <div className="gallery-fullscreen-bar" onClick={(event) => event.stopPropagation()}>
              <strong>{expanded.label}</strong>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export function ReadyImage({
  src,
  previewSrc,
  alt,
  onClick,
}: {
  src: string;
  previewSrc?: string;
  alt: string;
  onClick?: (event: MouseEvent<HTMLImageElement>) => void;
}) {
  const [readySrc, setReadySrc] = useState<string | null>(null);
  const showFull = !previewSrc || previewSrc === src || readySrc === src;
  useEffect(() => {
    if (!previewSrc || previewSrc === src) return;
    const loader = new Image();
    let active = true;
    loader.onload = async () => {
      // Keep the thumbnail visible until the full image is ready to paint.
      try {
        await loader.decode();
      } catch {
        // A successful load can still be displayed if decoding is unavailable.
      }
      if (active) setReadySrc(src);
    };
    loader.src = src;
    return () => {
      active = false;
    };
  }, [src, previewSrc]);
  return <img src={showFull ? src : previewSrc} alt={alt} onClick={onClick} />;
}

function ViewerPane({ image, onExpand }: { image: GalleryImage; onExpand: () => void }) {
  return (
    <div className="gallery-viewer-pane">
      <div className="gallery-viewer-image">
        <ReadyImage src={image.src} previewSrc={image.previewSrc || image.thumbSrc} alt={image.label} />
      </div>
      <button
        type="button"
        className="gallery-viewer-expand"
        title="View full screen"
        aria-label={`View ${image.label} full screen`}
        onClick={onExpand}
      >
        Full screen
      </button>
    </div>
  );
}

function ViewerControls({ onClose, onNavigate }: {
  onClose: () => void;
  onNavigate?: (direction: number) => void;
}) {
  return (
    <>
      <button type="button" className="viewer-control viewer-close" aria-label="Close image viewer" title="Close" onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
      {onNavigate && (
        <>
          <button type="button" className="viewer-control viewer-previous" aria-label="Previous image" title="Previous image" onClick={() => onNavigate(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg>
          </button>
          <button type="button" className="viewer-control viewer-next" aria-label="Next image" title="Next image" onClick={() => onNavigate(1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5 7 7-7 7" /></svg>
          </button>
        </>
      )}
    </>
  );
}
