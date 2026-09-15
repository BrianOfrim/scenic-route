import { useEffect, useId, useRef, useState } from "react";
import type { Basemap } from "./MapView";

const OPTIONS: { value: Basemap; label: string }[] = [
  { value: "osm", label: "Streets" },
  { value: "satellite", label: "Satellite" },
  { value: "schematic", label: "Schematic" },
];

type Props = {
  value: Basemap;
  onChange: (value: Basemap) => void;
};

export function BasemapControl({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`map-basemap${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`map-basemap-toggle${open ? " on" : ""}`}
        aria-label={open ? "Hide map type" : "Map type"}
        title={open ? "Hide map type" : "Map type"}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4.5 7.2 12 3.8l7.5 3.4v9.6L12 20.2 4.5 16.8V7.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M12 3.8v16.4M4.5 7.2 12 10.6l7.5-3.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="map-basemap-menu" id={menuId} role="menu" aria-label="Map type">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              className={`map-basemap-option${value === option.value ? " on" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
