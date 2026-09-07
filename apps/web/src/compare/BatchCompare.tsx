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
  const left = images.find((item) => item.id === leftId) ?? images[0];
  const right = images.find((item) => item.id === rightId) ?? images[1] ?? images[0];
  if (!left || !right) return null;

  return (
    <div className="batch-compare">
      <div className="compare-stage-wrap">
        <div className="compare-stage">
          <ComparePane image={left} side="left" active={focus === "left"} onFocus={onFocus} />
          <ComparePane image={right} side="right" active={focus === "right"} onFocus={onFocus} />
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
      <p className="muted compare-hint">
        Click a side, then a thumbnail, to place any two images from this run — including the schematic.
      </p>
    </div>
  );
}

function ComparePane({
  image,
  side,
  active,
  onFocus,
}: {
  image: CompareImage;
  side: Side;
  active: boolean;
  onFocus: (side: Side) => void;
}) {
  return (
    <button
      type="button"
      className={`compare-pane ${active ? "on" : ""}`}
      onClick={() => onFocus(side)}
    >
      <img src={image.src} alt={image.label} />
      <span className="compare-caption">
        {side === "left" ? "L" : "R"} · {image.label}
      </span>
    </button>
  );
}
