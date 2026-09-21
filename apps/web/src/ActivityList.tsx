import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  formatDate,
  formatKm,
  isUploadedActivity,
  type ActivitySummary,
  type StatusPayload,
} from "./api";

type Props = {
  status: StatusPayload | null;
  activities: ActivitySummary[];
  selectedId: number | null;
  busy: boolean;
  importing: boolean;
  onSelect: (id: number) => void;
  onSync: () => void;
  onDisconnect: () => void;
  onImport: (files: File[]) => void;
  onRemove: (ids: number[]) => Promise<void>;
};

export function ActivityList({
  status,
  activities,
  selectedId,
  busy,
  importing,
  onSelect,
  onSync,
  onDisconnect,
  onImport,
  onRemove,
}: Props) {
  const [query, setQuery] = useState("");
  const [sport, setSport] = useState("all");
  const [dragOver, setDragOver] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [stravaMenuOpen, setStravaMenuOpen] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [removing, setRemoving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const stravaMenuRef = useRef<HTMLDivElement>(null);
  const stravaMenuId = useId();
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
  const removable = selectedFiltered.filter(isUploadedActivity);
  const allFilteredChecked = filtered.length > 0 && selectedFiltered.length === filtered.length;
  const someFilteredChecked = selectedFiltered.length > 0 && !allFilteredChecked;
  const strava = status?.strava;
  const locked = busy || importing || removing;

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

  useEffect(() => {
    if (!stravaMenuOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (stravaMenuRef.current && !stravaMenuRef.current.contains(event.target as Node)) {
        setStravaMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setStravaMenuOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [stravaMenuOpen]);

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
    const skipped = selectedFiltered.length - removable.length;
    const detail =
      removable.length === 1
        ? `Remove “${removable[0].name}”?`
        : `Remove ${removable.length} uploaded ${removable.length === 1 ? "activity" : "activities"}?`;
    const extra = skipped ? ` ${skipped} Strava ${skipped === 1 ? "activity" : "activities"} will be kept.` : "";
    if (!window.confirm(`${detail}${extra}`)) return;
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
            {!status
              ? "Checking Strava…"
              : strava?.connected
                ? `${strava.athlete ? `${strava.athlete.firstname} ${strava.athlete.lastname} · ` : ""}${strava.sync.streamsSynced} tracks${strava.sync.streamsPending ? ` · ${strava.sync.streamsPending} pending` : ""}`
                : strava?.configured
                  ? "Upload a track or Strava export zip, or "
                  : "Add Strava keys to .env.local, or upload a track or Strava export zip."}
            {status && strava?.configured && !strava.connected ? (
              <a href="/api/strava/auth">connect Strava</a>
            ) : null}
          </p>
          <div className="row activity-toolbar">
            <button
              type="button"
              className="text-btn activity-upload"
              onClick={() => fileInput.current?.click()}
              disabled={locked}
            >
              {importing ? "Importing…" : "Upload files"}
            </button>
            {strava?.connected && (
              <div className="strava-menu" ref={stravaMenuRef}>
                <button
                  type="button"
                  className="text-btn strava-menu-trigger"
                  aria-haspopup="menu"
                  aria-expanded={stravaMenuOpen}
                  aria-controls={stravaMenuId}
                  onClick={() => setStravaMenuOpen((value) => !value)}
                  disabled={locked}
                >
                  {busy && !importing ? "Syncing…" : "Strava"}
                  <span aria-hidden="true">▾</span>
                </button>
                {stravaMenuOpen && (
                  <div className="strava-menu-panel" id={stravaMenuId} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStravaMenuOpen(false);
                        onSync();
                      }}
                    >
                      Refresh from Strava
                    </button>
                    <button
                      type="button"
                      className="danger"
                      role="menuitem"
                      title="Unlink this Strava account so you can connect a different one"
                      onClick={() => {
                        setStravaMenuOpen(false);
                        onDisconnect();
                      }}
                    >
                      Disconnect Strava
                    </button>
                  </div>
                )}
              </div>
            )}
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
                  {removable.length !== selectedFiltered.length
                    ? ` · ${removable.length} uploaded`
                    : ""}
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
                {item.source === "gpx" ? " · GPX" : item.source === "fit" ? " · FIT" : item.source === "tcx" ? " · TCX" : ""}
                {item.hasGps ? ` · ${formatKm(item.distance)}` : " · no GPS"}
              </span>
            </button>
          </div>
        ))}
        {!filtered.length && (
          <p className="muted activity-empty">
            {activities.length
              ? "No matching activities."
              : "No activities yet. Upload a GPX, FIT, TCX, or a Strava export zip, or sync Strava."}
          </p>
        )}
      </div>
    </aside>
  );
}
