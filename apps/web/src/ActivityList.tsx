import { useMemo, useState } from "react";
import {
  formatDate,
  formatDuration,
  formatKm,
  type ActivitySummary,
  type StatusPayload,
} from "./api";

type Props = {
  status: StatusPayload | null;
  activities: ActivitySummary[];
  selectedId: number | null;
  busy: boolean;
  onSelect: (id: number) => void;
  onSync: () => void;
  onCreatePoster: () => void;
};

export function ActivityList({
  status,
  activities,
  selectedId,
  busy,
  onSelect,
  onSync,
  onCreatePoster,
}: Props) {
  const [query, setQuery] = useState("");
  const [sport, setSport] = useState("all");
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
  const selected = activities.find((item) => item.id === selectedId) ?? null;
  const strava = status?.strava;

  return (
    <aside className="panel activity-panel">
      <div className="panel-block">
        <div className="eyebrow">Activities</div>
        <p className="muted">
          {!status
            ? "Checking Strava…"
            : strava?.connected
              ? `${strava.athlete ? `${strava.athlete.firstname} ${strava.athlete.lastname} · ` : ""}${strava.sync.streamsSynced} tracks${strava.sync.streamsPending ? ` · ${strava.sync.streamsPending} pending` : ""}`
              : strava?.configured
                ? ""
                : "Add Strava keys to .env.local"}
          {status && strava?.configured && !strava.connected ? (
            <a href="/api/strava/auth">Connect Strava</a>
          ) : null}
        </p>
        <div className="row">
          <button type="button" className="button" onClick={onSync} disabled={busy || !strava?.connected}>
            {busy ? "Syncing…" : "Sync Strava"}
          </button>
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
      <div className="activity-list">
        {filtered.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`activity ${item.id === selectedId ? "on" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            <strong>{item.name}</strong>
            <span>
              {formatDate(item.startDate)} · {item.sportType}
              {item.hasGps ? ` · ${formatKm(item.distance)}` : " · no GPS"}
            </span>
          </button>
        ))}
        {!filtered.length && <p className="muted">No matching activities.</p>}
      </div>
      {selected && (
        <div className="panel-block">
          <p className="muted">
            {formatKm(selected.distance)}
            {selected.movingTime != null ? ` · ${formatDuration(selected.movingTime)}` : ""}
          </p>
          <button
            type="button"
            className="button"
            disabled={!selected.hasGps || !selected.streamsSynced}
            onClick={onCreatePoster}
          >
            Make poster
          </button>
        </div>
      )}
    </aside>
  );
}
