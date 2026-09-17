import { useCallback, useEffect, useState, type CSSProperties } from "react";
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
import { BasemapControl } from "./BasemapControl";
import { Gallery } from "./gallery/Gallery";
import { ProfileMenu } from "./ProfileMenu";
import { SignIn } from "./SignIn";
import { MapView, type Basemap, type LandmarkHighlight } from "./MapView";
import { PosterPanel, type PosterSheetSnap } from "./poster/PosterPanel";
import type { SchematicLayers } from "./poster/grounding/renderSchematic";
import { MOBILE_QUERY, useMediaQuery } from "./useMediaQuery";

type MobilePane = "activities" | "map";
type AppTab = MobilePane | "gallery";

const SHEET_OFFSET_FALLBACK: Record<PosterSheetSnap, string> = {
  peek: "96px",
  half: "260px",
  full: "calc(100% - 52px)",
};

const SHEET_OFFSET_FALLBACK_PX: Record<PosterSheetSnap, number> = {
  peek: 96,
  half: 260,
  full: 520,
};

function AppTabs({
  active,
  isMobile,
  onSelect,
}: {
  active: AppTab;
  isMobile: boolean;
  onSelect: (tab: AppTab) => void;
}) {
  const tabs: { id: AppTab; label: string; mobileOnly?: boolean }[] = [
    { id: "activities", label: "Activities", mobileOnly: true },
    { id: "map", label: "Map" },
    { id: "gallery", label: "Gallery" },
  ];

  return (
    <nav className="app-tabs" aria-label="Primary">
      {tabs
        .filter((tab) => isMobile || !tab.mobileOnly)
        .map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={active === tab.id ? "on" : ""}
            aria-current={active === tab.id ? "page" : undefined}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
    </nav>
  );
}

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
  const [posterSheet, setPosterSheet] = useState<PosterSheetSnap>("half");
  const [posterSheetOffset, setPosterSheetOffset] = useState(SHEET_OFFSET_FALLBACK.half);
  const [posterSheetHeightPx, setPosterSheetHeightPx] = useState(SHEET_OFFSET_FALLBACK_PX.half);
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
  const [routeOnly, setRouteOnly] = useState(true);
  const [refineFrom, setRefineFrom] = useState<PosterRecord | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("schematic");
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

  const setPosterSheetSnap = useCallback((next: PosterSheetSnap) => {
    setPosterSheet((current) => {
      if (current === next) return current;
      setPosterSheetOffset(SHEET_OFFSET_FALLBACK[next]);
      setPosterSheetHeightPx(SHEET_OFFSET_FALLBACK_PX[next]);
      setViewNonce((value) => value + 1);
      return next;
    });
  }, []);

  const onPosterSheetHeight = useCallback((heightPx: number) => {
    const rounded = Math.round(heightPx);
    setPosterSheetOffset(`${rounded}px`);
    setPosterSheetHeightPx((prev) => (Math.abs(prev - rounded) < 4 ? prev : rounded));
  }, []);

  const openPosterOnMobile = useCallback(() => {
    setPosterOpen(true);
    setPosterSheet("half");
    setPosterSheetOffset(SHEET_OFFSET_FALLBACK.half);
    setPosterSheetHeightPx(SHEET_OFFSET_FALLBACK_PX.half);
    openMobilePane("map");
    setViewNonce((value) => value + 1);
  }, [openMobilePane]);

  const activityReadyForPoster = useCallback(
    (id: number | null) => {
      if (id == null) return false;
      const activity = activities.find((item) => item.id === id);
      return Boolean(activity?.hasGps && activity.streamsSynced);
    },
    [activities],
  );

  const closePoster = useCallback(() => {
    setPosterOpen(false);
    setSelectedId(null);
    setRouteOnly(true);
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
    const stravaStatus = params.get("strava");
    if (stravaStatus === "error" || stravaStatus === "taken") {
      const message = params.get("message");
      setError(
        stravaStatus === "taken"
          ? (message ?? "That Strava account is already connected to another Scenic Route user")
          : (message ?? "Strava connection failed"),
      );
    }
    const refineId = params.get("refine");
    if (stravaStatus || refineId) {
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
          setPosterSheet("half");
          setMobilePane("map");
          setViewNonce((value) => value + 1);
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
        openPosterOnMobile();
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

  const profileMenu = (
    <ProfileMenu email={session.email} onSignOut={() => void handleSignOut()} />
  );

  const selectTab = (tab: AppTab) => {
    if (tab === "gallery") {
      go("/gallery");
      return;
    }
    if (path.startsWith("/gallery")) go("/");
    if (isMobile) {
      if (tab === "map" && activityReadyForPoster(selectedId)) {
        openPosterOnMobile();
      } else {
        openMobilePane(tab);
      }
    }
  };

  if (path.startsWith("/gallery")) {
    return (
      <Gallery
        account={profileMenu}
        tabs={<AppTabs active="gallery" isMobile={isMobile} onSelect={selectTab} />}
        onEditSetup={(poster) => {
          setSelectedId(poster.activityId);
          setRefineFrom(poster);
          openPosterOnMobile();
          go("/");
        }}
      />
    );
  }

  const basemapSelect = <BasemapControl value={basemap} onChange={setBasemap} />;

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
          {profileMenu}
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
        data-poster-sheet={isMobile && posterOpen ? posterSheet : undefined}
        style={
          isMobile && posterOpen && mobilePane === "map"
            ? ({ "--poster-sheet-h": posterSheetOffset } as CSSProperties)
            : undefined
        }
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
              openPosterOnMobile();
            } else {
              setPosterOpen(false);
              setRouteOnly(true);
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
          {basemapSelect}
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
            fitPaddingBottom={
              isMobile && posterOpen && mobilePane === "map" ? posterSheetHeightPx : 0
            }
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
            sheetSnap={isMobile ? posterSheet : null}
            onSheetSnapChange={isMobile ? setPosterSheetSnap : undefined}
            onSheetHeightChange={isMobile ? onPosterSheetHeight : undefined}
            onClose={closePoster}
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
        ) : null}
      </div>
      <AppTabs
        active={isMobile ? mobilePane : "map"}
        isMobile={isMobile}
        onSelect={selectTab}
      />
    </div>
  );
}
