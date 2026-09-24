import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatDate,
  formatKm,
  type ActivitySummary,
} from "./api";
import type { ImportNotice } from "./importNotice";

type Props = {
  activities: ActivitySummary[];
  selectedId: number | null;
  importing: boolean;
  importNotice: ImportNotice | null;
  onDismissImportNotice: () => void;
  onSelect: (id: number) => void;
  onImport: (files: File[]) => void;
  onRemove: (ids: number[]) => Promise<void>;
};

export function ActivityList({
  activities,
  selectedId,
  importing,
  importNotice,
  onDismissImportNotice,
  onSelect,
  onImport,
  onRemove,
}: Props) {
  const [query, setQuery] = useState("");
  const [sport, setSport] = useState("all");
  const [dragOver, setDragOver] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [removing, setRemoving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const sports = useMemo(
    () => Array.from(new Set(activities.map((item) => item.sportType))).sort(),
    [activities],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return activities.filter((item) => {
      if (sport !== "all" && item.sportType !== sport) return false;
      if (!needle) return true;
      return item.name.toLowerCase().includes(needle) || item.sportType.toLowerCase().includes(needle);
    });
  }, [activities, query, sport]);
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selectedFiltered = filtered.filter((item) => checked.has(item.id));
  const removable = selectedFiltered;
  const allFilteredChecked = filtered.length > 0 && selectedFiltered.length === filtered.length;
  const someFilteredChecked = selectedFiltered.length > 0 && !allFilteredChecked;
  const locked = importing || removing;

  useEffect(() => {
    const live = new Set(activities.map((item) => item.id));
    setChecked((current) => {
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [activities]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredChecked;
  }, [someFilteredChecked]);

  function takeFiles(list: FileList | File[] | null) {
    const files = list ? Array.from(list) : [];
    if (files.length) onImport(files);
    if (fileInput.current) fileInput.current.value = "";
  }

  function toggleChecked(id: number, on: boolean) {
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setSelectMode(on: boolean) {
    setSelecting(on);
    if (!on) setChecked(new Set());
  }

  function toggleSelectAll() {
    setChecked((current) => {
      const next = new Set(current);
      if (allFilteredChecked) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  }

  async function handleRemove() {
    if (!removable.length) return;
    const detail =
      removable.length === 1
        ? `Remove “${removable[0].name}”?`
        : `Remove ${removable.length} uploaded ${removable.length === 1 ? "activity" : "activities"}?`;
    if (!window.confirm(detail)) return;
    setRemoving(true);
    try {
      await onRemove(removable.map((item) => item.id));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <aside
      className={`panel activity-panel${dragOver ? " drop-target" : ""}${selecting ? " selecting" : ""}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        takeFiles(event.dataTransfer.files);
      }}
    >
      <div className="activity-header">
        <div className="panel-block">
          <div className="eyebrow">Activities</div>
          <p className="muted">
            Import one or more GPX, FIT, or TCX files, or a complete account export ZIP. Original archives are not retained.
          </p>
          <div className="row activity-toolbar">
            <button
              type="button"
              className="text-btn activity-upload"
              onClick={() => fileInput.current?.click()}
              disabled={locked}
              title="Choose one or more GPX, FIT, or TCX files"
            >
              {importing ? "Importing…" : "Import activities"}
            </button>
            {activities.length > 0 && (
              <button
                type="button"
                className={`text-btn${selecting ? " on" : ""}`}
                onClick={() => setSelectMode(!selecting)}
                disabled={locked}
              >
                {selecting ? "Done" : "Select"}
              </button>
            )}
            <input
              ref={fileInput}
              className="file-input"
              type="file"
              accept=".gpx,.gpx.gz,.fit,.fit.gz,.tcx,.tcx.gz,.zip,application/gpx+xml,application/vnd.garmin.tcx+xml,application/vnd.ant.fit,application/zip,application/x-zip-compressed,application/octet-stream"
              multiple
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => takeFiles(event.target.files)}
            />
          </div>
        </div>
        <div className="panel-block">
          <input
            className="search"
            placeholder="Search rides"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="filter">
            Sport
            <select value={sport} onChange={(event) => setSport(event.target.value)}>
              <option value="all">All</option>
              {sports.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selecting && filtered.length > 0 && (
          <div className="panel-block activity-select-bar">
            <label className="activity-select-all">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allFilteredChecked}
                onChange={toggleSelectAll}
                disabled={locked}
              />
              Select all
            </label>
            {selectedFiltered.length > 0 && (
              <div className="row activity-actions">
                <span className="muted">
                  {selectedFiltered.length} selected
                </span>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => void handleRemove()}
                  disabled={locked || !removable.length}
                >
                  {removing ? "Removing…" : "Remove"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {importNotice && (
        <div className="import-result" data-tone={importNotice.tone} role="status">
          <div className="import-result-head">
            <p>{importNotice.summary}</p>
            <button type="button" className="text-btn" onClick={onDismissImportNotice}>
              dismiss
            </button>
          </div>
          {importNotice.failures.length > 0 && (
            <ul>
              {importNotice.failures.slice(0, 6).map((item, index) => (
                <li key={`${item.filename}-${index}`}>
                  <span className="import-file">{item.filename}</span>
                  <span className="import-reason">{item.error}</span>
                </li>
              ))}
            </ul>
          )}
          {importNotice.failures.length > 6 && (
            <p className="muted import-more">and {importNotice.failures.length - 6} more</p>
          )}
        </div>
      )}
      <div className="activity-list">
        {filtered.map((item) => (
          <div key={item.id} className={`activity-row${item.id === selectedId ? " on" : ""}`}>
            {selecting && (
              <label className="activity-check">
                <input
                  type="checkbox"
                  checked={checked.has(item.id)}
                  onChange={(event) => toggleChecked(item.id, event.target.checked)}
                  disabled={locked}
                  aria-label={`Select ${item.name}`}
                />
              </label>
            )}
            <button type="button" className="activity" onClick={() => onSelect(item.id)}>
              <strong>{item.name}</strong>
              <span>
                {formatDate(item.startDate)} · {item.sportType}
                {` · ${item.format.toUpperCase()}`}
                {item.origin === "archive" ? " · Archive" : ""}
                {item.hasGps ? ` · ${formatKm(item.distance)}` : " · no GPS"}
              </span>
            </button>
          </div>
        ))}
        {!filtered.length && (
          <p className="muted activity-empty">
            {activities.length
              ? "No matching activities."
              : "No activities yet. Select one or more GPX, FIT, or TCX files, or a complete account export ZIP."}
          </p>
        )}
      </div>
    </aside>
  );
}
