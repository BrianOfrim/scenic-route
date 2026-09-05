import { useCallback, useEffect, useState } from "react";
import {
  fetchActivities,
  fetchActivityTrack,
  fetchFeatures,
  fetchPoster,
  fetchStatus,
  syncStrava,
  type ActivitySummary,
  type FeatureOption,
  type PosterPoi,
  type PosterRecord,
  type StatusPayload,
} from "./api";
import { ActivityList } from "./ActivityList";
import { Gallery } from "./gallery/Gallery";
import { MapView } from "./MapView";
import { PosterPanel } from "./poster/PosterPanel";

const EMPTY_POIS: PosterPoi[] = [];

function currentPath() {
  return window.location.pathname;
}

export function App() {
  const [path, setPath] = useState(currentPath);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [features, setFeatures] = useState<FeatureOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedLatLng, setSelectedLatLng] = useState<[number, number][] | null>(null);
  const [cropLatLng, setCropLatLng] = useState<[number, number][] | null>(null);
  const [pois, setPois] = useState<PosterPoi[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posterOpen, setPosterOpen] = useState(false);
  const [refineFrom, setRefineFrom] = useState<PosterRecord | null>(null);
  const [basemap, setBasemap] = useState<"osm" | "topo">("osm");
  const [viewNonce, setViewNonce] = useState(0);

  const go = useCallback((next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
  }, []);

  const refresh = useCallback(async () => {
    const [nextStatus, nextActivities, nextFeatures] = await Promise.all([
      fetchStatus(),
      fetchActivities(),
      fetchFeatures().catch(() => []),
    ]);
    setStatus(nextStatus);
    setActivities(nextActivities);
    setFeatures(nextFeatures);
    return nextStatus;
  }, []);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("strava") === "error") {
      setError(params.get("message") ?? "Strava connection failed");
    }
    const refineId = params.get("refine");
    if (params.get("strava") || refineId) {
      window.history.replaceState({}, "", "/");
      setPath("/");
    }
    let cancelled = false;
    async function boot() {
      const next = await refresh();
      if (refineId) {
        const poster = await fetchPoster(refineId);
        if (!cancelled) {
          setSelectedId(poster.activityId);
          setRefineFrom(poster);
          setPosterOpen(true);
        }
      }
      const sync = next.strava.sync;
      if (!cancelled && next.strava.connected && (sync.listed === 0 || sync.streamsPending > 0)) {
        await handleSync();
      }
    }
    boot().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (selectedId == null) {
      setSelectedLatLng(null);
      return;
    }
    let cancelled = false;
    fetchActivityTrack(selectedId)
      .then((body) => {
        if (!cancelled) setSelectedLatLng(body.latlng);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load track");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function handleSync() {
    setBusy(true);
    setError(null);
    try {
      let progress = await syncStrava();
      await refresh();
      while (!progress.done && !progress.rateLimited) {
        progress = await syncStrava();
        await refresh();
      }
      if (progress.rateLimited) {
        setError(
          `Strava rate limit reached. ${progress.streamsSynced} tracks stored; sync again later for the rest.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  if (path.startsWith("/gallery")) {
    return (
      <Gallery
        onBack={() => go("/")}
        onRefine={(poster) => {
          setSelectedId(poster.activityId);
          setRefineFrom(poster);
          setPosterOpen(true);
          go("/");
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="brand">Scenic Route</p>
          <h1>Strava route posters</h1>
        </div>
        <div className="top-actions">
          {error && (
            <p className="error banner">
              {error}
              <button type="button" className="text-btn" onClick={() => setError(null)}>
                dismiss
              </button>
            </p>
          )}
          <label className="filter">
            Basemap
            <select value={basemap} onChange={(event) => setBasemap(event.target.value as "osm" | "topo")}>
              <option value="osm">Streets</option>
              <option value="topo">Terrain</option>
            </select>
          </label>
          <button type="button" className="text-btn" onClick={() => go("/gallery")}>
            Gallery
          </button>
        </div>
      </header>
      <div className={`workspace ${posterOpen ? "with-poster" : ""}`}>
        <ActivityList
          status={status}
          activities={activities}
          selectedId={selectedId}
          busy={busy}
          onSelect={(id) => {
            setSelectedId(id);
            setRefineFrom(null);
          }}
          onSync={() => {
            void handleSync();
          }}
          onCreatePoster={() => {
            setPosterOpen(true);
            setViewNonce((value) => value + 1);
          }}
        />
        <main className="stage">
          <MapView
            selectedLatLng={selectedLatLng}
            cropLatLng={posterOpen ? cropLatLng : null}
            pois={posterOpen ? pois : EMPTY_POIS}
            basemap={basemap}
            viewNonce={viewNonce}
          />
        </main>
        {posterOpen && selectedId != null && (
          <PosterPanel
            activityId={selectedId}
            features={features}
            refineFrom={refineFrom}
            onClose={() => {
              setPosterOpen(false);
              setCropLatLng(null);
              setPois([]);
              setRefineFrom(null);
            }}
            onCropChange={setCropLatLng}
            onPoisChange={setPois}
          />
        )}
      </div>
    </div>
  );
}
