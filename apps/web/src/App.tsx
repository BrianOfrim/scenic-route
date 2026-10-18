import { SignInForm } from "./SignIn";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AuthRequiredError,
  fetchActivities,
  fetchActivityTrack,
  fetchFeatures,
  fetchPoster,
  fetchSession,
  importActivityFiles,
  ImportRequestError,
  removeActivities,
  signOut,
  type ActivitySummary,
  type FeatureOption,
  type NamedArea,
  type NamedWay,
  type PosterPoi,
  type PosterRecord,
  type PosterWays,
  type SessionUser,
} from "./api";
import type { ImportStatus } from "./importProgress";
import { ActivityList } from "./ActivityList";
import { formatImportNotice, type ImportNotice } from "./importNotice";
import { BasemapControl } from "./BasemapControl";
import { Gallery } from "./gallery/Gallery";
import { ProfileMenu } from "./ProfileMenu";
import { Landing } from "./Landing";
import type { Basemap, LandmarkHighlight } from "./MapView";
import type { PosterSheetSnap } from "./poster/PosterPanel";
import { defaultPeopleForUser } from "./poster/people";
import type { GeoMask } from "./poster/grounding/geoMask";
import type { SchematicLayers } from "./poster/grounding/renderSchematic";
import type { GeoEdit } from "./poster/polygonEdit";
import { MOBILE_QUERY, useMediaQuery } from "./useMediaQuery";

const MapView = lazy(() => import("./MapView").then((module) => ({ default: module.MapView })));
const PosterPanel = lazy(() => import("./poster/PosterPanel").then((module) => ({ default: module.PosterPanel })));

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
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [features, setFeatures] = useState<FeatureOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedLatLng, setSelectedLatLng] = useState<[number, number][] | null>(null);
  const [selectedRouteBreaks, setSelectedRouteBreaks] = useState<number[]>([]);
  const [trackLoading, setTrackLoading] = useState(false);
  const [geometryLoading, setGeometryLoading] = useState(false);
  const [cropLatLng, setCropLatLng] = useState<[number, number][] | null>(null);
  const [cropRouteBreaks, setCropRouteBreaks] = useState<number[]>([]);
  const [cropStops, setCropStops] = useState<[number, number][]>([]);
  const [pois, setPois] = useState<PosterPoi[]>([]);
  const [namedWays, setNamedWays] = useState<NamedWay[]>([]);
  const [namedAreas, setNamedAreas] = useState<NamedArea[]>([]);
  const [mapHighlight, setMapHighlight] = useState<LandmarkHighlight | null>(null);
  const [ways, setWays] = useState<PosterWays | null>(null);
  const [geoOverlay, setGeoOverlay] = useState<{
    active: boolean;
    preview: boolean;
    kind: "polygon" | "rectangle";
    points: [number, number][];
    selected: number | null;
    rectPending: boolean;
  }>({
    active: false,
    preview: false,
    kind: "polygon",
    points: [],
    selected: null,
    rectPending: false,
  });
  const [geoMask, setGeoMask] = useState<GeoMask | null>(null);
  const geoEditRef = useRef<(edit: GeoEdit) => void>(() => {});
  const bindGeoEdit = useCallback((handler: (edit: GeoEdit) => void) => {
    geoEditRef.current = handler;
  }, []);
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
  const [editTrailExtent, setEditTrailExtent] = useState<{
    name: string;
    nonce: number;
  } | null>(null);
  const [renameTrail, setRenameTrail] = useState<{
    name: string;
    next: string;
    nonce: number;
  } | null>(null);
  const [renameLandmark, setRenameLandmark] = useState<{
    name: string;
    next: string;
    nonce: number;
  } | null>(null);
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
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

  const clearPosterMapState = useCallback(() => {
    setCropLatLng(null);
    setCropStops([]);
    setPois([]);
    setNamedWays([]);
    setNamedAreas([]);
    setMapHighlight(null);
    setWays(null);
    setSchematicLayers(null);
  }, []);

  const selectActivity = useCallback(
    (id: number, freshActivity?: ActivitySummary) => {
      const activity = freshActivity ?? activities.find((item) => item.id === id);
      setSelectedLatLng(null);
      setTrackLoading(true);
      clearPosterMapState();
      setSelectedId(id);
      setRefineFrom(null);
      if (activity?.hasGps && activity.streamsSynced) {
        openPosterOnMobile();
      } else {
        setPosterOpen(false);
        setRouteOnly(true);
      }
    },
    [activities, clearPosterMapState, openPosterOnMobile],
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
    setActivitiesLoading(true);
    try {
      const [nextActivities, nextFeatures] = await Promise.all([
        fetchActivities(),
        fetchFeatures().catch(() => []),
      ]);
      setActivities(nextActivities);
      setFeatures(nextFeatures);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setSession(null);
        throw err;
      }
      throw err;
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refineId = params.get("refine");
    if (refineId) {
      window.history.replaceState({}, "", "/");
      setPath("/");
    }
    let cancelled = false;
    async function boot() {
      const user = await fetchSession();
      if (cancelled) return;
      setSession(user);
      if (!user || user.betaStatus === "waiting") return;
      await refresh();
      if (refineId) {
        const poster = await fetchPoster(refineId);
        if (!cancelled) {
          setSelectedLatLng(null);
          setTrackLoading(true);
          setSelectedId(poster.activityId);
          setRefineFrom(poster);
          setPosterOpen(true);
          setPosterSheet("half");
          setMobilePane("map");
          setViewNonce((value) => value + 1);
        }
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
      setSelectedRouteBreaks([]);
      setTrackLoading(false);
      return;
    }
    let cancelled = false;
    setSelectedLatLng(null);
    setSelectedRouteBreaks([]);
    setTrackLoading(true);
    fetchActivityTrack(selectedId)
      .then((body) => {
        if (!cancelled) {
          setSelectedLatLng(body.latlng);
          setSelectedRouteBreaks(body.routeBreaks ?? []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load track");
      })
      .finally(() => {
        if (!cancelled) setTrackLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

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
        setError(result.skipped ? "Some activities could not be removed" : "Nothing to remove");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove activities");
    }
  }

  async function handleImport(files: File[]) {
    setImporting(true);
    setImportStatus({ phase: "preparing" });
    if (isMobile) openMobilePane("activities");
    setError(null);
    setImportNotice(null);
    try {
      const result = await importActivityFiles(files, setImportStatus);
      setImportStatus(current => ({ phase: "refreshing", progress: current?.progress }));
      await refresh();
      const notice = formatImportNotice({
        imported: result.activities.length,
        skipped: result.skipped,
        errors: result.errors,
      });
      setImportNotice(notice);
      const latest = result.activities.reduce<ActivitySummary | undefined>((current, activity) =>
        !current || activity.startDate > current.startDate ? activity : current, undefined);
      if (latest) selectActivity(latest.id, latest);
      else if (notice && isMobile) openMobilePane("activities");
    } catch (err) {
      if (err instanceof ImportRequestError && (err.failures.length || err.skipped)) {
        setImportNotice(formatImportNotice({ imported: 0, skipped: err.skipped, errors: err.failures }));
        if (isMobile) openMobilePane("activities");
      } else {
        setError(err instanceof Error ? err.message : "Import failed");
      }
    } finally {
      setImporting(false);
      setImportStatus(null);
    }
  }

  async function handleSignOut() {
    await signOut();
    setSession(null);
    setActivities([]);
    setSelectedId(null);
    setPosterOpen(false);
  }

  if (window.location.pathname === "/reset-password") {
    return <div className="sign-in"><SignInForm reset /></div>;
  }

  if (session === undefined) {
    return (
      <div className="sign-in">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <Landing />;
  }

  if (session.betaStatus === "waiting") {
    return <div className="sign-in"><div className="auth-card">
      <ProfileMenu email={session.email} name={session.name} image={session.image} waiting
        onNameSaved={(name) => setSession(current => current ? { ...current, name } : current)}
        onSignOut={() => void handleSignOut()} />
      <h2>You’re on the waitlist</h2>
      <p>The free public beta has room for 100 accounts. Your account is saved, and imports and poster generation will unlock when an operator admits you.</p>
      <p>Signed in as {session.email}. Check back here for access.</p>
      <button className="button" onClick={() => window.location.reload()}>Check access</button>
      <button className="text-btn" onClick={() => void handleSignOut()}>Sign out</button>
    </div></div>;
  }

  const profileMenu = (
    <ProfileMenu email={session.email} name={session.name} image={session.image}
      onNameSaved={(name) => setSession((current) => current ? { ...current, name } : current)}
      onSignOut={() => void handleSignOut()} />
  );

  const selectTab = (tab: AppTab) => {
    if (tab === "gallery") {
      go("/gallery");
      return;
    }
    if (path.startsWith("/gallery")) {
      go("/");
    }
    if (isMobile) {
      if (tab === "map" && activityReadyForPoster(selectedId)) {
        // Keep an in-progress editor mounted as-is when returning from gallery.
        if (posterOpen) openMobilePane("map");
        else openPosterOnMobile();
      } else {
        openMobilePane(tab);
      }
    }
  };

  const showGallery = path.startsWith("/gallery");
  const basemapSelect = <BasemapControl value={basemap} onChange={setBasemap} />;

  return (
    <>
      {/* Stay mounted under gallery so mobile generate/edit state survives tab switches. */}
      <div
        className={`app${isMobile ? " is-mobile" : ""}`}
        hidden={showGallery}
        aria-hidden={showGallery}
      >
        <header className="top">
          <div>
            <div className="brand-lockup">
              <img className="brand-mark" src="/logo/sr-path-sage.svg" alt="" width={40} height={40} />
              <div>
                <p className="brand">Scenic{isMobile ? <br /> : " "}Route</p>
              </div>
            </div>
          </div>
          {!isMobile && <AppTabs active="map" isMobile={false} onSelect={selectTab} />}
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
            activities={activities}
            loading={activitiesLoading}
            selectedId={selectedId}
            importing={importing}
            importStatus={importStatus}
            importNotice={importNotice}
            onDismissImportNotice={() => setImportNotice(null)}
            onSelect={selectActivity}
            onImport={(files) => {
              void handleImport(files);
            }}
            onRemove={(ids) => handleRemove(ids)}
          />
          <main className="stage">
            {basemapSelect}
            <Suspense fallback={null}>
            <MapView
              selectedLatLng={selectedLatLng}
              selectedRouteBreaks={selectedRouteBreaks}
              trackLoading={trackLoading}
              geometryLoading={posterOpen && geometryLoading}
              cropLatLng={posterOpen ? cropLatLng : null}
              cropRouteBreaks={posterOpen ? cropRouteBreaks : []}
              cropStops={posterOpen ? cropStops : []}
              pois={posterOpen ? pois : EMPTY_POIS}
              namedWays={posterOpen ? namedWays : EMPTY_WAYS}
              namedAreas={posterOpen ? namedAreas : EMPTY_AREAS}
              ways={posterOpen ? ways : null}
              schematicLayers={posterOpen ? schematicLayers : null}
              basemap={basemap}
              visible={!showGallery && (!isMobile || mobilePane === "map")}
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
              editTrailExtent={editTrailExtent}
              onRenameLandmark={(draft) =>
                setRenameLandmark({ name: draft.from, next: draft.name, nonce: Date.now() })
              }
              onRenameTrail={(draft) => setRenameTrail({ name: draft.from, next: draft.name, nonce: Date.now() })}
              geoOutline={geoOverlay.points}
              geoOutlineActive={geoOverlay.active}
              geoOutlinePreview={geoOverlay.preview}
              geoOutlineKind={geoOverlay.kind}
              geoOutlineSelected={geoOverlay.selected}
              geoRectPending={geoOverlay.rectPending}
              geoMask={posterOpen ? geoMask : null}
              onGeoEdit={(edit) => geoEditRef.current(edit)}
            />
            </Suspense>
          </main>
          {posterOpen && selectedId != null ? (
            <Suspense fallback={null}>
            <PosterPanel
              key={selectedId}
              activityId={selectedId}
              defaultPeople={defaultPeopleForUser(session)}
              activityLabel={activities.find((item) => item.id === selectedId)?.name}
              features={features}
              refineFrom={refineFrom}
              touchUi={isMobile}
              sheetSnap={isMobile ? posterSheet : null}
              onSheetSnapChange={isMobile ? setPosterSheetSnap : undefined}
              onSheetHeightChange={isMobile ? onPosterSheetHeight : undefined}
              onClose={closePoster}
              onCropChange={setCropLatLng}
              onBreaksChange={setCropRouteBreaks}
              onStopsChange={setCropStops}
              onPoisChange={setPois}
              onNamedWaysChange={setNamedWays}
              onNamedAreasChange={setNamedAreas}
              onHighlightChange={setMapHighlight}
              onWaysChange={setWays}
              onGeometryLoadingChange={setGeometryLoading}
              onSchematicLayersChange={setSchematicLayers}
              onNeedSchematic={() => setBasemap("schematic")}
              onGeoOutlineChange={setGeoOverlay}
              onGeoMaskChange={setGeoMask}
              onBindGeoEdit={bindGeoEdit}
              onRouteOnlyChange={setRouteOnly}
              onGenerationStarted={() => {
                go("/gallery");
              }}
              dismissPoi={dismissPoi}
              dismissArea={dismissArea}
              dismissTrail={dismissTrail}
              placeLandmark={placeLandmark}
              moveLandmark={moveLandmark}
              placeSection={placeSection}
              onEditTrailExtent={(name) => setEditTrailExtent({ name, nonce: Date.now() })}
              renameLandmark={renameLandmark}
              renameTrail={renameTrail}
            />
            </Suspense>
          ) : null}
        </div>
        {isMobile && <AppTabs active={mobilePane} isMobile onSelect={selectTab} />}
      </div>
      {/* Stay mounted so tab switches and in-flight generate do not refetch or blank the list. */}
      <div className="gallery-host" hidden={!showGallery} aria-hidden={!showGallery}>
        <Gallery
          account={profileMenu}
          tabs={<AppTabs active="gallery" isMobile={isMobile} onSelect={selectTab} />}
          onEditSetup={(poster) => {
            setSelectedLatLng(null);
            setTrackLoading(true);
            clearPosterMapState();
            setSelectedId(poster.activityId);
            setRefineFrom(poster);
            openPosterOnMobile();
            go("/");
          }}
        />
      </div>
    </>
  );
}
