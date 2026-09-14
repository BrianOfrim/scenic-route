import { useCallback, useEffect, useState } from "react";
import {
  AuthRequiredError,
  fetchActivities,
  fetchActivityTrack,
  fetchFeatures,
  fetchPoster,
  fetchSession,
  fetchStatus,
  importGpxFiles,
  removeActivities,
  signOut,
  syncStrava,
  type ActivitySummary,
  type FeatureOption,
  type NamedArea,
  type NamedWay,
  type PosterPoi,
  type PosterRecord,
  type PosterWays,
  type SessionUser,
  type StatusPayload,
} from "./api";
import { ActivityList } from "./ActivityList";
import { Gallery } from "./gallery/Gallery";
import { SignIn } from "./SignIn";
import { MapView, type Basemap, type LandmarkHighlight } from "./MapView";
import { PosterPanel } from "./poster/PosterPanel";
import type { SchematicLayers } from "./poster/grounding/renderSchematic";
import { MOBILE_QUERY, useMediaQuery } from "./useMediaQuery";

type MobilePane = "activities" | "map" | "poster";

const EMPTY_POIS: PosterPoi[] = [];
const EMPTY_WAYS: NamedWay[] = [];
const EMPTY_AREAS: NamedArea[] = [];

function currentPath() {
  return window.location.pathname;
}

export function App() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [path, setPath] = useState(currentPath);
  const [mobilePane, setMobilePane] = useState<MobilePane>("activities");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [features, setFeatures] = useState<FeatureOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedLatLng, setSelectedLatLng] = useState<[number, number][] | null>(null);
  const [cropLatLng, setCropLatLng] = useState<[number, number][] | null>(null);
  const [cropStops, setCropStops] = useState<[number, number][]>([]);
  const [pois, setPois] = useState<PosterPoi[]>([]);
  const [namedWays, setNamedWays] = useState<NamedWay[]>([]);
  const [namedAreas, setNamedAreas] = useState<NamedArea[]>([]);
  const [mapHighlight, setMapHighlight] = useState<LandmarkHighlight | null>(null);
  const [ways, setWays] = useState<PosterWays | null>(null);
  const [schematicLayers, setSchematicLayers] = useState<SchematicLayers | null>(null);
  const [dismissPoi, setDismissPoi] = useState<{ name: string; nonce: number } | null>(null);
  const [dismissArea, setDismissArea] = useState<{ name: string; nonce: number } | null>(null);
  const [dismissTrail, setDismissTrail] = useState<{ name: string; nonce: number } | null>(null);
  const [placeLandmark, setPlaceLandmark] = useState<{
    name: string;
    lat: number;
    lng: number;
    nonce: number;
  } | null>(null);
  const [moveLandmark, setMoveLandmark] = useState<{
    name: string;
    lat: number;
    lng: number;
    nonce: number;
  } | null>(null);
  const [placeSection, setPlaceSection] = useState<{
    name: string;
    start: number;
    end: number;
    nonce: number;
  } | null>(null);
  const [renameTrail, setRenameTrail] = useState<{
    name: string;
    next: string;
    nonce: number;
  } | null>(null);
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posterOpen, setPosterOpen] = useState(false);
  const [routeOnly, setRouteOnly] = useState(false);
  const [refineFrom, setRefineFrom] = useState<PosterRecord | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("osm");
  const [viewNonce, setViewNonce] = useState(0);

  const go = useCallback((next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
  }, []);

  const openMobilePane = useCallback((next: MobilePane) => {
    setMobilePane((current) => {
      if (next === "map" && current !== "map") {
        setViewNonce((value) => value + 1);
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextActivities, nextFeatures] = await Promise.all([
        fetchStatus(),
        fetchActivities(),
        fetchFeatures().catch(() => []),
      ]);
      setStatus(nextStatus);
      setActivities(nextActivities);
      setFeatures(nextFeatures);
      return nextStatus;
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setSession(null);
        throw err;
      }
      throw err;
    }
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
      const user = await fetchSession();
      if (cancelled) return;
      setSession(user);
      if (!user) return;
      const next = await refresh();
      if (refineId) {
        const poster = await fetchPoster(refineId);
        if (!cancelled) {
          setSelectedId(poster.activityId);
          setRefineFrom(poster);
          setPosterOpen(true);
          setMobilePane("poster");
        }
      }
      const sync = next.strava.sync;
      if (!cancelled && next.strava.connected && (sync.listed === 0 || sync.streamsPending > 0)) {
        await handleSync();
      }
    }
    boot().catch((err: unknown) => {
      if (cancelled) return;
      if (err instanceof AuthRequiredError) {
        setSession(null);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load");
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

  async function handleRemove(ids: number[]) {
    setError(null);
    try {
      const result = await removeActivities(ids);
      await refresh();
      const removed = new Set(result.deleted.map((item) => item.id));
      if (selectedId != null && removed.has(selectedId)) {
        setSelectedId(null);
        setPosterOpen(false);
        setRefineFrom(null);
        setRouteOnly(false);
        setCropLatLng(null);
        setCropStops([]);
        setPois([]);
        setNamedWays([]);
        setNamedAreas([]);
        setMapHighlight(null);
        setWays(null);
        setSchematicLayers(null);
      }
      if (!result.deleted.length) {
        setError(result.skipped ? "Strava activities cannot be removed here" : "Nothing to remove");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove activities");
    }
  }

  async function handleImport(files: File[]) {
    setImporting(true);
    setError(null);
    try {
      const result = await importGpxFiles(files);
      await refresh();
      const first = result.activities[0];
      if (first && result.activities.length === 1 && !result.skipped) {
        setSelectedId(first.id);
        setRefineFrom(null);
        setPosterOpen(true);
        setMobilePane("poster");
        setViewNonce((value) => value + 1);
      } else if (first) {
        setSelectedId(first.id);
      }
      const parts: string[] = [];
      if (result.activities.length > 1) parts.push(`Imported ${result.activities.length} activities`);
      if (result.skipped) {
        parts.push(
          `${result.skipped} already in your library`,
        );
      }
      if (result.errors.length) {
        parts.push(
          result.errors.length <= 3
            ? result.errors.map((item) => `${item.filename}: ${item.error}`).join(" · ")
            : `${result.errors.length} files could not be imported`,
        );
      }
      if (parts.length) setError(parts.join(". "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    setSession(null);
    setStatus(null);
    setActivities([]);
    setSelectedId(null);
    setPosterOpen(false);
  }

  if (session === undefined) {
    return (
      <div className="sign-in">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  const accountChip = (
    <div className="account-chip">
      <span>{session.email}</span>
      <button type="button" className="text-btn" onClick={() => void handleSignOut()}>
        Sign out
      </button>
    </div>
  );

  if (path.startsWith("/gallery")) {
    return (
      <Gallery
        account={accountChip}
        onBack={() => go("/")}
        onEditSetup={(poster) => {
          setSelectedId(poster.activityId);
          setRefineFrom(poster);
          setPosterOpen(true);
          setMobilePane("poster");
          go("/");
        }}
      />
    );
  }

  const basemapSelect = (
    <label className="filter map-basemap">
      Basemap
      <select value={basemap} onChange={(event) => setBasemap(event.target.value as Basemap)}>
        <option value="osm">Streets</option>
        <option value="satellite">Satellite</option>
        <option value="schematic">Schematic</option>
      </select>
    </label>
  );

  return (
    <div className={`app${isMobile ? " is-mobile" : ""}`}>
      <header className="top">
        <div>
          <div className="brand-lockup">
            <img className="brand-mark" src="/logo/sr-path-sage.svg" alt="" width={40} height={40} />
            <div>
              <p className="brand">Scenic Route</p>
              <h1>Route posters</h1>
            </div>
          </div>
        </div>
        <div className="top-actions">
          {!isMobile && error && (
            <p className="error banner">
              {error}
              <button type="button" className="text-btn" onClick={() => setError(null)}>
                dismiss
              </button>
            </p>
          )}
          {!isMobile && basemapSelect}
          <button type="button" className="text-btn" onClick={() => go("/gallery")}>
            Gallery
          </button>
          {accountChip}
        </div>
      </header>
      {isMobile && error && (
        <p className="error banner app-error">
          {error}
          <button type="button" className="text-btn" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}
      <div
        className={`workspace ${posterOpen ? "with-poster" : ""}`}
        data-mobile-pane={isMobile ? mobilePane : undefined}
      >
        <ActivityList
          status={status}
          activities={activities}
          selectedId={selectedId}
          busy={busy}
          importing={importing}
          onSelect={(id) => {
            const activity = activities.find((item) => item.id === id);
            setSelectedId(id);
            setRefineFrom(null);
            if (activity?.hasGps && activity.streamsSynced) {
              setPosterOpen(true);
              openMobilePane("map");
              setViewNonce((value) => value + 1);
            } else {
              setPosterOpen(false);
              setRouteOnly(false);
              setCropLatLng(null);
              setCropStops([]);
              setPois([]);
              setNamedWays([]);
              setNamedAreas([]);
              setMapHighlight(null);
              setWays(null);
              setSchematicLayers(null);
            }
          }}
          onSync={() => {
            void handleSync();
          }}
          onImport={(files) => {
            void handleImport(files);
          }}
          onRemove={(ids) => handleRemove(ids)}
        />
        <main className="stage">
          {isMobile && basemapSelect}
          <MapView
            selectedLatLng={selectedLatLng}
            cropLatLng={posterOpen ? cropLatLng : null}
            cropStops={posterOpen ? cropStops : []}
            pois={posterOpen ? pois : EMPTY_POIS}
            namedWays={posterOpen ? namedWays : EMPTY_WAYS}
            namedAreas={posterOpen ? namedAreas : EMPTY_AREAS}
            ways={posterOpen ? ways : null}
            schematicLayers={posterOpen ? schematicLayers : null}
            basemap={basemap}
            viewNonce={viewNonce}
            labelingEnabled={posterOpen && !routeOnly}
            highlight={posterOpen ? mapHighlight : null}
            touchUi={isMobile}
            onRemovePoi={(name) => setDismissPoi({ name, nonce: Date.now() })}
            onRemoveArea={(name) => setDismissArea({ name, nonce: Date.now() })}
            onRemoveTrail={(name) => setDismissTrail({ name, nonce: Date.now() })}
            onNeedSchematic={() => setBasemap("schematic")}
            onPlaceLandmark={(draft) => setPlaceLandmark({ ...draft, nonce: Date.now() })}
            onMoveLandmark={(draft) => setMoveLandmark({ ...draft, nonce: Date.now() })}
            onPlaceSection={(draft) => setPlaceSection({ ...draft, nonce: Date.now() })}
            onRenameTrail={(draft) => setRenameTrail({ name: draft.from, next: draft.name, nonce: Date.now() })}
          />
        </main>
        {posterOpen && selectedId != null ? (
          <PosterPanel
            activityId={selectedId}
            features={features}
            refineFrom={refineFrom}
            touchUi={isMobile}
            onClose={() => {
              setPosterOpen(false);
              setRouteOnly(false);
              setCropLatLng(null);
              setCropStops([]);
              setPois([]);
              setNamedWays([]);
              setNamedAreas([]);
              setMapHighlight(null);
              setWays(null);
              setSchematicLayers(null);
              setDismissPoi(null);
              setDismissArea(null);
              setDismissTrail(null);
              setPlaceLandmark(null);
              setMoveLandmark(null);
              setPlaceSection(null);
              setRenameTrail(null);
              setRefineFrom(null);
            }}
            onCropChange={setCropLatLng}
            onStopsChange={setCropStops}
            onPoisChange={setPois}
            onNamedWaysChange={setNamedWays}
            onNamedAreasChange={setNamedAreas}
            onHighlightChange={setMapHighlight}
            onWaysChange={setWays}
            onSchematicLayersChange={setSchematicLayers}
            onRouteOnlyChange={setRouteOnly}
            dismissPoi={dismissPoi}
            dismissArea={dismissArea}
            dismissTrail={dismissTrail}
            placeLandmark={placeLandmark}
            moveLandmark={moveLandmark}
            placeSection={placeSection}
            renameTrail={renameTrail}
          />
        ) : isMobile ? (
          <aside className="panel poster-panel poster-empty">
            <div className="panel-block">
              <div className="eyebrow">Poster</div>
              <p className="muted">Pick an activity with GPS to set up a poster.</p>
              <button type="button" className="button" onClick={() => openMobilePane("activities")}>
                Activities
              </button>
            </div>
          </aside>
        ) : null}
      </div>
      {isMobile && (
        <nav className="mobile-tabs" aria-label="Workspace">
          <button
            type="button"
            className={mobilePane === "activities" ? "on" : ""}
            aria-current={mobilePane === "activities" ? "page" : undefined}
            onClick={() => openMobilePane("activities")}
          >
            Activities
          </button>
          <button
            type="button"
            className={mobilePane === "map" ? "on" : ""}
            aria-current={mobilePane === "map" ? "page" : undefined}
            onClick={() => openMobilePane("map")}
          >
            Map
          </button>
          <button
            type="button"
            className={mobilePane === "poster" ? "on" : ""}
            aria-current={mobilePane === "poster" ? "page" : undefined}
            onClick={() => openMobilePane("poster")}
          >
            Poster
          </button>
        </nav>
      )}
    </div>
  );
}
