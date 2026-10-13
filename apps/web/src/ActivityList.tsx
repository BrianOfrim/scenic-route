import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatDate,
  formatKm,
  type ActivitySummary,
} from "./api";
import type { ImportStatus } from "./importProgress";
import type { ImportNotice } from "./importNotice";
import { TrackImportHelp } from "./TrackImportHelp";

type Props = {
  activities: ActivitySummary[];
  loading: boolean;
  selectedId: number | null;
  importing: boolean;
  importStatus: ImportStatus | null;
  importNotice: ImportNotice | null;
  onDismissImportNotice: () => void;
  onSelect: (id: number) => void;
  onImport: (files: File[]) => void;
  onRemove: (ids: number[]) => Promise<void>;
};

export function ActivityList({
  activities,
  loading,
  selectedId,
  importing,
  importStatus,
  importNotice,
  onDismissImportNotice,
  onSelect,
  onImport,
  onRemove,
}: Props) {
  const [query, setQuery] = useState("");
  const [sport, setSport] = useState("all");
  const [dragOver, setDragOver] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [removalMode, setRemovalMode] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importHelpDialog = useRef<HTMLDialogElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectionMenuRef = useRef<HTMLDetailsElement>(null);
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
  const removable = activities.filter((item) => checked.has(item.id));
  const hiddenCheckedCount = removable.length - selectedFiltered.length;
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
  }, [someFilteredChecked, removalMode]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const menu = selectionMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      const menu = selectionMenuRef.current;
      if (event.key === "Escape" && menu?.open) {
        event.preventDefault();
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

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

  function cancelRemoval() {
    setChecked(new Set());
    setRemovalMode(false);
  }

  function selectActivities(action: "all" | "none") {
    setChecked((current) => {
      if (action === "none") return new Set();
      const next = new Set(current);
      for (const id of filteredIds) {
        next.add(id);
      }
      return next;
    });
    if (selectionMenuRef.current) selectionMenuRef.current.open = false;
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
      className={`panel activity-panel${dragOver ? " drop-target" : ""}`}
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
          <div className="row activity-toolbar">
            <div className="activity-import-actions">
              <button
                type="button"
                className="text-btn activity-upload"
                onClick={() => fileInput.current?.click()}
                disabled={locked}
                title="Choose one or more GPX, FIT, or TCX files"
              >
                {importing ? "Importing…" : "Import"}
              </button>
              <button
                type="button"
                className="text-btn track-import-help-button"
                aria-label="Help exporting GPS tracks"
                aria-haspopup="dialog"
                title="How to export GPS tracks from your activity app"
                onClick={() => importHelpDialog.current?.showModal()}
              >
                ?
              </button>
            </div>
            {activities.length > 0 && !removalMode && (
              <button
                type="button"
                className="text-btn activity-remove-mode"
                onClick={() => setRemovalMode(true)}
                disabled={locked}
              >
                Remove
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
        <div className="panel-block activity-filters">
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
        {activities.length > 0 && removalMode && (
          <div className="panel-block activity-select-bar">
            <div className="activity-selection-control">
              <label className="activity-select-all" title="Mark all shown activities for removal">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allFilteredChecked}
                  aria-label="Mark all shown activities for removal"
                  onChange={toggleSelectAll}
                  disabled={locked || !filtered.length}
                />
                <span>All shown</span>
              </label>
              <details className="activity-selection-menu" ref={selectionMenuRef}>
                <summary aria-label="Removal selection options" title="Selection options">▾</summary>
                <div className="activity-selection-options">
                  <button type="button" disabled={locked || !filtered.length} onClick={() => selectActivities("all")}>All</button>
                  <button type="button" disabled={locked || !checked.size} onClick={() => selectActivities("none")}>None</button>
                </div>
              </details>
            </div>
            <button type="button" className="text-btn activity-removal-cancel" onClick={cancelRemoval} disabled={removing}>
              Cancel
            </button>
            <div className="row activity-actions activity-removal-actions">
              <span className="muted" role="status">
                {removable.length ? `${removable.length} marked for removal` : "Choose activities to remove"}
                {hiddenCheckedCount > 0 && ` (${hiddenCheckedCount} hidden by filters)`}
              </span>
              <button
                type="button"
                className="text-btn"
                onClick={() => void handleRemove()}
                disabled={locked || !removable.length}
              >
                {removing ? "Removing…" : `Remove (${removable.length})`}
              </button>
            </div>
          </div>
        )}
      </div>
      {importing && importStatus && (
        <div className="import-progress" role="status" aria-live="polite" aria-atomic="true">
          <div className="import-progress-heading">
            <span className="spinner" aria-hidden="true" />
            <strong>{importStatus.phase === "preparing" ? "Preparing your import…"
              : importStatus.phase === "refreshing" ? "Loading your activities…" : "Importing activities…"}</strong>
          </div>
          <progress
            aria-label="Activity import progress"
            max={importStatus.progress?.total || 1}
            value={importStatus.progress ? importStatus.progress.processed : undefined}
          />
          {importStatus.progress && (
            <>
              <div className="import-progress-count">
                <strong>{importStatus.progress.processed} / {importStatus.progress.total}</strong>
                <span>activities processed</span>
              </div>
              <p>{importStatus.progress.imported} imported
                {importStatus.progress.skipped > 0 && ` · ${importStatus.progress.skipped} already imported`}
                {importStatus.progress.failed > 0 && ` · ${importStatus.progress.failed} failed`}
              </p>
            </>
          )}
          <p className="muted">{importStatus.phase === "preparing"
            ? "Uploading files and finding activities. Large exports may take a moment."
            : importStatus.phase === "refreshing" ? "Finishing up and updating your activity list."
            : "Keep this page open while your activities are saved."}</p>
        </div>
      )}
      {importNotice && !importing && (
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
      <div className="activity-list" aria-busy={loading}>
        {loading && (
          <div className="muted activity-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            Loading activities…
          </div>
        )}
        {filtered.map((item) => (
          <div key={item.id} className={`activity-row${item.id === selectedId ? " on" : ""}`}>
            {removalMode && (
              <label className="activity-check">
                <input
                  type="checkbox"
                  checked={checked.has(item.id)}
                  onChange={(event) => toggleChecked(item.id, event.target.checked)}
                  disabled={locked}
                  aria-label={`Mark ${item.name} for removal`}
                />
              </label>
            )}
            <button type="button" className="activity" onClick={() => onSelect(item.id)} aria-current={item.id === selectedId ? "true" : undefined}>
              <div className="activity-title">
                <strong>{item.name}</strong>
                {item.id === selectedId && <span className="activity-on-map">On map</span>}
              </div>
              <span>
                {formatDate(item.startDate)} · {item.sportType}
                {` · ${item.format.toUpperCase()}`}
                {item.origin === "archive" ? " · Archive" : ""}
                {item.hasGps ? ` · ${formatKm(item.distance)}` : " · no GPS"}
              </span>
            </button>
          </div>
        ))}
        {!loading && !importing && !filtered.length && (activities.length ? (
          <p className="muted activity-empty">No matching activities.</p>
        ) : (
          <section className="activity-empty track-import-empty" aria-labelledby="track-import-empty-title">
            <h2 id="track-import-empty-title">Bring your adventures here</h2>
            <TrackImportHelp />
          </section>
        ))}
      </div>
      <dialog
        ref={importHelpDialog}
        className="track-import-help-dialog"
        aria-labelledby="track-import-help-title"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom
          ) {
            event.currentTarget.close();
          }
        }}
      >
        <div className="track-import-help-header">
          <h2 id="track-import-help-title">Export your GPS tracks</h2>
          <button
            type="button"
            className="text-btn"
            onClick={() => importHelpDialog.current?.close()}
          >
            Close
          </button>
        </div>
        <p className="muted">
          Import GPX, FIT, TCX, or account export ZIPs. Original archives are not retained.
        </p>
        <TrackImportHelp />
      </dialog>
    </aside>
  );
}
