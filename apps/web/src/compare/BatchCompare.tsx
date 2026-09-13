import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CompareImage = {
  id: string;
  src: string;
  label: string;
};

export function defaultComparePair(images: CompareImage[], preferredRight?: string) {
  const schematic = images.find((item) => item.id === "schematic");
  const right =
    images.find((item) => item.id === preferredRight && item.id !== "schematic") ??
    images.find((item) => item.id !== "schematic") ??
    images[1] ??
    images[0];
  const left =
    schematic && schematic.id !== right?.id
      ? schematic
      : (images.find((item) => item.id !== right?.id) ?? images[0]);
  return {
    leftId: left?.id ?? "",
    rightId: right?.id ?? left?.id ?? "",
  };
}

type Side = "left" | "right";

type Props = {
  images: CompareImage[];
  leftId: string;
  rightId: string;
  focus: Side;
  onFocus: (side: Side) => void;
  onSelect: (id: string) => void;
  onSwap?: () => void;
};

export function BatchCompare({ images, leftId, rightId, focus, onFocus, onSelect, onSwap }: Props) {
  const [expanded, setExpanded] = useState<CompareImage | null>(null);
  const canCloseRef = useRef(false);
  const left = images.find((item) => item.id === leftId) ?? images[0];
  const right = images.find((item) => item.id === rightId) ?? images[1] ?? images[0];

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
        return;
      }
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.closest("input, textarea, select") || event.target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.key === "f" || event.key === "F") && !expanded) {
        const focused = focus === "left" ? left : right;
        if (focused) {
          event.preventDefault();
          setExpanded(focused);
        }
        return;
      }
      if (!expanded || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
      if (images.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const index = images.findIndex((item) => item.id === expanded.id);
      if (index < 0) return;
      const next = event.key === "ArrowRight" ? index + 1 : index - 1;
      setExpanded(images[(next + images.length) % images.length]);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded, focus, images, left, right]);

  if (!left || !right) return null;

  function expand(image: CompareImage, side: Side) {
    canCloseRef.current = false;
    onFocus(side);
    setExpanded(image);
  }

  function closeExpanded() {
    setExpanded(null);
  }

  function closeBackdrop() {
    if (!canCloseRef.current) return;
    setExpanded(null);
  }

  return (
    <div className="batch-compare">
      <div className="compare-stage-wrap">
        <div className="compare-stage">
          <ComparePane
            image={left}
            side="left"
            active={focus === "left"}
            onFocus={onFocus}
            onExpand={() => expand(left, "left")}
          />
          <ComparePane
            image={right}
            side="right"
            active={focus === "right"}
            onFocus={onFocus}
            onExpand={() => expand(right, "right")}
          />
        </div>
        {onSwap && images.length > 1 && (
          <button type="button" className="compare-swap" onClick={onSwap} title="Swap sides">
            ⇄
          </button>
        )}
      </div>
      <div className="lightbox-thumbs">
        {images.map((image) => {
          const onLeft = image.id === left.id;
          const onRight = image.id === right.id;
          return (
            <button
              key={image.id}
              type="button"
              className={[onLeft ? "on-left" : "", onRight ? "on-right" : ""].filter(Boolean).join(" ")}
              onClick={() => onSelect(image.id)}
            >
              <img src={image.src} alt={image.label} />
              <span>
                {image.label}
                {onLeft ? " · L" : ""}
                {onRight ? " · R" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {images.length > 1 && (
        <div className="compare-nav">
          <button type="button" className="text-btn" onClick={() => onFocus("left")}>
            Left
          </button>
          <button type="button" className="text-btn" onClick={() => onFocus("right")}>
            Right
          </button>
        </div>
      )}
      <p className="muted compare-hint">
        Click a side, then a thumbnail, to place any two images from this run — including the schematic.
        Double-click a poster or use Full screen to view it larger. Esc leaves full screen first.
      </p>
      {expanded &&
        createPortal(
          <div
            className="compare-fullscreen"
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              closeBackdrop();
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
                <button type="button" className="text-btn" onClick={closeExpanded}>
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

function ComparePane({
  image,
  side,
  active,
  onFocus,
  onExpand,
}: {
  image: CompareImage;
  side: Side;
  active: boolean;
  onFocus: (side: Side) => void;
  onExpand: () => void;
}) {
  return (
    <div className={`compare-pane ${active ? "on" : ""}`}>
      <button type="button" className="compare-pane-hit" onClick={() => onFocus(side)} onDoubleClick={onExpand}>
        <img src={image.src} alt={image.label} />
        <span className="compare-caption">
          {side === "left" ? "L" : "R"} · {image.label}
        </span>
      </button>
      <button
        type="button"
        className="compare-expand"
        title="View full screen"
        aria-label={`View ${image.label} full screen`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onExpand();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onExpand();
        }}
      >
        Full screen
      </button>
    </div>
  );
}
