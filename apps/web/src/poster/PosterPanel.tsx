import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  fetchMaxReferences,
  fetchPosterContext,
  fetchPosters,
  formatKm,
  generatePoster,
  lookupPosterLandmark,
  planPoster,
  type FormattedStat,
  type PosterContext,
  type PosterPoi,
  type PosterRecord,
  type PosterSpec,
} from "../api";
import { clampCrop, paddedBbox, sliceTrack, trackDistanceM } from "./crop";
import { FEATURE_CATALOG, DEFAULT_FEATURE_IDS, type FeatureOption } from "./featureCatalog";
import { planContactSheets, renderContactSheets, type GroundingLayer } from "./grounding/contactSheet";
import { renderSchematicDataUrl, type AspectRatio } from "./grounding/renderSchematic";
import { snapshotTiles } from "./grounding/snapshotTiles";
import { SpecEditor } from "./SpecEditor";
import { DEFAULT_POSTER_STYLE, POSTER_STYLES } from "./styles";

const ASPECTS: AspectRatio[] = ["2:3", "3:4", "1:1", "4:3", "16:9"];

type GroundingKey = "schematic" | "terrain" | "streets" | "satellite" | "silhouette";

type Props = {
  activityId: number;
  features: FeatureOption[];
  onClose: () => void;
  onCropChange?: (crop: [number, number][] | null) => void;
  onPoisChange?: (pois: PosterPoi[]) => void;
  refineFrom?: PosterRecord | null;
};

export function PosterPanel({
  activityId,
  features,
  onClose,
  onCropChange,
  onPoisChange,
  refineFrom,
}: Props) {
  const catalog = features.length ? features : FEATURE_CATALOG;
  const [context, setContext] = useState<PosterContext | null>(null);
  const [history, setHistory] = useState<PosterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureIds, setFeatureIds] = useState<string[]>(DEFAULT_FEATURE_IDS);
  const [styleId, setStyleId] = useState(refineFrom?.styleId || DEFAULT_POSTER_STYLE.id);
  const [stylePrompt, setStylePrompt] = useState(refineFrom?.stylePrompt || DEFAULT_POSTER_STYLE.prompt);
  const [title, setTitle] = useState("");
  const [statIds, setStatIds] = useState<string[]>(["title", "date", "distance", "movingTime"]);
  const [labels, setLabels] = useState<string[]>([]);
  const [customPois, setCustomPois] = useState<PosterPoi[]>([]);
  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState(1);
  const [landmarkQuery, setLandmarkQuery] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [landmarkChoices, setLandmarkChoices] = useState<PosterPoi[] | null>(null);
  const [landmarkHint, setLandmarkHint] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("2:3");
  const [groundingOn, setGroundingOn] = useState<Record<GroundingKey, boolean>>({
    schematic: true,
    terrain: true,
    streets: false,
    satellite: false,
    silhouette: false,
  });
  const [previews, setPreviews] = useState<Partial<Record<GroundingKey, string>>>({});
  const [maxRefs, setMaxRefs] = useState(3);
  const [spec, setSpec] = useState<PosterSpec | null>(refineFrom?.spec ?? null);
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<PosterRecord | null>(null);
  const [refineNotes, setRefineNotes] = useState("");

  useEffect(() => {
    void fetchMaxReferences().then(setMaxRefs);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPosterContext(activityId, featureIds),
      fetchPosters(activityId).catch(() => []),
    ])
      .then(([next, posters]) => {
        if (cancelled) return;
        setContext(next);
        setHistory(posters);
        setTitle(next.activity.name || "Ride");
        setLabels(next.pois.map((poi) => poi.name));
        setCropStart(0);
        setCropEnd(Math.max(1, next.latlng.length - 1));
        if (refineFrom) {
          setStatIds(refineFrom.stats.map((item) => item.label.toLowerCase().replace(/\s+/g, "")));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load poster context");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, featureIds.join(",")]);

  const croppedLatLng = useMemo(() => {
    if (!context?.latlng?.length) return [];
    return sliceTrack(context.latlng, cropStart, cropEnd);
  }, [context, cropStart, cropEnd]);

  const selectedPois = useMemo(() => {
    const suggested = (context?.pois ?? []).filter((poi) => labels.includes(poi.name));
    const seen = new Set(suggested.map((poi) => poi.name.toLowerCase()));
    return [...suggested, ...customPois.filter((poi) => !seen.has(poi.name.toLowerCase()))];
  }, [context, labels, customPois]);

  const displayBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return context?.bbox ?? null;
    return paddedBbox(croppedLatLng, selectedPois);
  }, [context, croppedLatLng, selectedPois]);

  const selectedStats = useMemo(() => {
    const available = context?.stats ?? [];
    const extras: FormattedStat[] = title
      ? [{ id: "title", label: "Title", value: title }, ...available.filter((item) => item.id !== "title")]
      : available;
    return extras.filter((item) => statIds.includes(item.id) || (item.id === "title" && statIds.includes("title")));
  }, [context, statIds, title]);

  const subtitle = useMemo(() => {
    return selectedStats
      .filter((item) => item.id !== "title")
      .map((item) => item.value)
      .join(" · ");
  }, [selectedStats]);

  useEffect(() => {
    onCropChange?.(croppedLatLng.length >= 2 ? croppedLatLng : null);
  }, [croppedLatLng, onCropChange]);

  useEffect(() => {
    onPoisChange?.(selectedPois);
  }, [selectedPois, onPoisChange]);

  useEffect(() => () => onCropChange?.(null), [onCropChange]);

  useEffect(() => {
    if (croppedLatLng.length < 2 || !displayBbox) {
      setPreviews({});
      return;
    }
    try {
      const schematic = renderSchematicDataUrl({
        latlng: croppedLatLng,
        bbox: displayBbox,
        ways: context?.ways,
        pois: selectedPois,
        aspectRatio,
        layers: {
          roads: featureIds.includes("major-roads"),
          streets: featureIds.includes("streets"),
          paths: featureIds.includes("paths"),
          rail: featureIds.includes("rail"),
          water: featureIds.includes("lakes") || featureIds.includes("rivers"),
          forest: featureIds.includes("forest"),
          parks: featureIds.includes("parks"),
          farmland: featureIds.includes("farmland"),
          labels: true,
        },
      });
      const silhouette = renderSchematicDataUrl({
        latlng: croppedLatLng,
        bbox: displayBbox,
        aspectRatio,
        silhouette: true,
      });
      setPreviews((current) => ({ ...current, schematic, silhouette }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render schematic");
    }
  }, [context, croppedLatLng, displayBbox, selectedPois, aspectRatio, featureIds.join(",")]);

  useEffect(() => {
    if (!generating && !planning) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [generating, planning]);

  async function buildGrounding(): Promise<GroundingLayer[]> {
    if (!displayBbox || croppedLatLng.length < 2) return [];
    const layers: GroundingLayer[] = [];
    if (groundingOn.schematic && previews.schematic) {
      layers.push({
        role: "schematic",
        legend: "red = route; grey = roads; blue = water; green = forest; green/black dots = start/finish",
        dataUrl: previews.schematic,
      });
    }
    if (groundingOn.silhouette && previews.silhouette) {
      layers.push({ role: "silhouette", legend: "route only, north up", dataUrl: previews.silhouette });
    }
    const tileJobs: Array<{ key: GroundingKey; source: "topo" | "osm" | "satellite"; legend: string }> = [];
    if (groundingOn.terrain) tileJobs.push({ key: "terrain", source: "topo", legend: "OpenTopoMap terrain with route overlay" });
    if (groundingOn.streets) tileJobs.push({ key: "streets", source: "osm", legend: "OSM streets with route overlay" });
    if (groundingOn.satellite) tileJobs.push({ key: "satellite", source: "satellite", legend: "satellite imagery with route overlay" });
    for (const job of tileJobs) {
      const dataUrl =
        previews[job.key] ??
        (await snapshotTiles({
          source: job.source,
          bbox: displayBbox,
          latlng: croppedLatLng,
          aspectRatio,
        }));
      setPreviews((current) => ({ ...current, [job.key]: dataUrl }));
      layers.push({ role: job.key, legend: job.legend, dataUrl });
    }
    return layers;
  }

  async function handlePlan() {
    if (!context) return;
    setPlanning(true);
    setError(null);
    try {
      const layers = await buildGrounding();
      const packed = planContactSheets(layers, maxRefs);
      const style = POSTER_STYLES.find((item) => item.id === styleId) ?? DEFAULT_POSTER_STYLE;
      const planned = await planPoster({
        activity: {
          name: context.activity.name,
          sportType: context.activity.sportType,
          isLoop: context.activity.isLoop,
        },
        title,
        subtitle,
        stats: selectedStats.map((item) => ({ label: item.label, value: item.value })),
        style,
        customStylePrompt: styleId === "custom" || stylePrompt !== style.prompt ? stylePrompt : undefined,
        aspectRatio,
        geography: catalog.filter((item) => item.group === "geography" && featureIds.includes(item.id)),
        pois: selectedPois,
        grounding: packed.map((sheet, index) => ({
          index: index + 1,
          role: sheet.role,
          legend: sheet.legend,
        })),
        refineNotes: refineNotes || undefined,
        previousSpec: spec ?? undefined,
      });
      setSpec(planned.spec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Planner failed");
    } finally {
      setPlanning(false);
    }
  }

  async function handleGenerate() {
    if (!context || !spec) return;
    setGenerating(true);
    setError(null);
    try {
      const layers = await buildGrounding();
      const packed = await renderContactSheets(layers, maxRefs, aspectRatio);
      const record = await generatePoster({
        activityId,
        spec,
        references: packed.map((item) => item.dataUrl),
        previousPosterId: result?.posterId ?? refineFrom?.posterId,
        refineNotes: refineNotes || undefined,
        featureIds,
        labels: selectedPois.map((poi) => poi.name),
        stats: selectedStats.map((item) => ({ label: item.label, value: item.value })),
        styleId,
        stylePrompt,
        aspectRatio,
      });
      setResult(record);
      setHistory((current) => [record, ...current.filter((item) => item.posterId !== record.posterId)]);
      setRefineNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Poster generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleLookup(event: FormEvent) {
    event.preventDefault();
    const query = landmarkQuery.trim();
    if (!query || !context || lookingUp) return;
    setLookingUp(true);
    setLandmarkHint(null);
    setLandmarkChoices(null);
    try {
      const found = await lookupPosterLandmark({
        query,
        activityId,
        bbox: displayBbox ?? context.bbox,
        latlng: croppedLatLng,
      });
      if (found.picked) {
        addCustom(found.picked);
        setLandmarkQuery("");
        setLandmarkHint(`Added ${found.picked.name}`);
      } else if (found.candidates.length) {
        setLandmarkChoices(found.candidates);
        setLandmarkHint("Several matches — pick one.");
      } else {
        setLandmarkHint(found.warnings[0] ?? "No location found for that name.");
      }
    } catch (err) {
      setLandmarkHint(err instanceof Error ? err.message : "Landmark lookup failed");
    } finally {
      setLookingUp(false);
    }
  }

  function addCustom(poi: PosterPoi) {
    setCustomPois((current) =>
      current.some((item) => item.name.toLowerCase() === poi.name.toLowerCase()) ? current : [...current, poi],
    );
    setLabels((current) => (current.includes(poi.name) ? current : [...current, poi.name]));
    setLandmarkChoices(null);
  }

  function toggleFeature(id: string) {
    setFeatureIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function applyStyle(id: string) {
    const preset = POSTER_STYLES.find((item) => item.id === id) ?? DEFAULT_POSTER_STYLE;
    setStyleId(preset.id);
    if (preset.id !== "custom") setStylePrompt(preset.prompt);
  }

  const lastIndex = Math.max(1, (context?.latlng.length ?? 2) - 1);
  const croppedKm = trackDistanceM(croppedLatLng);
  const busy = planning || generating;

  return (
    <aside className="panel poster-panel">
      <div className="panel-block poster-head">
        <div>
          <div className="eyebrow">Poster</div>
          <strong>{context?.activity.name ?? "Create poster"}</strong>
        </div>
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </div>
      {loading && (
        <div className="panel-block">
          <p className="muted">Loading nearby features…</p>
        </div>
      )}
      {error && (
        <div className="panel-block">
          <p className="error">{error}</p>
        </div>
      )}
      {context && !loading && (
        <div className="poster-body">
          <div className="panel-block">
            <div className="eyebrow">Crop track</div>
            <label className="poster-crop-row">
              <span>Start</span>
              <input
                type="range"
                min={0}
                max={lastIndex - 1}
                value={cropStart}
                onChange={(event) => {
                  const [lo, hi] = clampCrop(context.latlng.length, Number(event.target.value), cropEnd);
                  setCropStart(lo);
                  setCropEnd(hi);
                }}
              />
            </label>
            <label className="poster-crop-row">
              <span>End</span>
              <input
                type="range"
                min={1}
                max={lastIndex}
                value={cropEnd}
                onChange={(event) => {
                  const [lo, hi] = clampCrop(context.latlng.length, cropStart, Number(event.target.value));
                  setCropStart(lo);
                  setCropEnd(hi);
                }}
              />
            </label>
            <p className="muted">{formatKm(croppedKm)}</p>
          </div>

          <div className="panel-block">
            <div className="eyebrow">Geography</div>
            {catalog
              .filter((item) => item.group === "geography")
              .map((item) => (
                <label key={item.id} className="check">
                  <input
                    type="checkbox"
                    checked={featureIds.includes(item.id)}
                    onChange={() => toggleFeature(item.id)}
                  />
                  {item.label}
                </label>
              ))}
          </div>

          <div className="panel-block">
            <div className="eyebrow">Landmarks</div>
            {catalog
              .filter((item) => item.group === "landmarks")
              .map((item) => (
                <label key={item.id} className="check">
                  <input
                    type="checkbox"
                    checked={featureIds.includes(item.id)}
                    onChange={() => toggleFeature(item.id)}
                  />
                  {item.label}
                </label>
              ))}
            <div className="chip-row">
              {context.pois.map((poi) => (
                <button
                  key={`${poi.name}-${poi.lat}`}
                  type="button"
                  className={`chip ${labels.includes(poi.name) ? "on" : ""}`}
                  onClick={() =>
                    setLabels((current) =>
                      current.includes(poi.name)
                        ? current.filter((name) => name !== poi.name)
                        : [...current, poi.name],
                    )
                  }
                >
                  {poi.name}
                </button>
              ))}
              {customPois.map((poi) => (
                <button
                  key={`custom-${poi.name}`}
                  type="button"
                  className="chip on"
                  onClick={() => {
                    setCustomPois((current) => current.filter((item) => item.name !== poi.name));
                    setLabels((current) => current.filter((name) => name !== poi.name));
                  }}
                >
                  {poi.name} ×
                </button>
              ))}
            </div>
            <form className="poster-lookup" onSubmit={(event) => void handleLookup(event)}>
              <input
                className="search"
                value={landmarkQuery}
                onChange={(event) => setLandmarkQuery(event.target.value)}
                placeholder="Add a landmark"
                disabled={lookingUp}
              />
              <button className="text-btn" type="submit" disabled={lookingUp || !landmarkQuery.trim()}>
                {lookingUp ? "Looking up…" : "Add"}
              </button>
            </form>
            {landmarkHint && <p className="muted">{landmarkHint}</p>}
            {landmarkChoices?.map((poi) => (
              <button key={`${poi.name}-${poi.lat}`} type="button" className="chip" onClick={() => addCustom(poi)}>
                {poi.name}
              </button>
            ))}
          </div>

          <div className="panel-block">
            <div className="eyebrow">Style</div>
            <div className="chip-row">
              {POSTER_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  className={`chip ${style.id === styleId ? "on" : ""}`}
                  onClick={() => applyStyle(style.id)}
                >
                  {style.label}
                </button>
              ))}
            </div>
            <textarea
              className="poster-prompt"
              rows={5}
              value={stylePrompt}
              onChange={(event) => {
                setStyleId("custom");
                setStylePrompt(event.target.value);
              }}
              placeholder="Custom style prompt"
            />
          </div>

          <div className="panel-block">
            <div className="eyebrow">Stats on poster</div>
            {(context.stats.length
              ? [{ id: "title", label: "Title", value: title }, ...context.stats.filter((item) => item.id !== "title")]
              : [{ id: "title", label: "Title", value: title }]
            ).map((stat) => (
              <label key={stat.id} className="check">
                <input
                  type="checkbox"
                  checked={statIds.includes(stat.id)}
                  onChange={() =>
                    setStatIds((current) =>
                      current.includes(stat.id)
                        ? current.filter((id) => id !== stat.id)
                        : [...current, stat.id],
                    )
                  }
                />
                {stat.label}
                {stat.value ? ` — ${stat.value}` : ""}
              </label>
            ))}
            <input className="search" value={title} onChange={(event) => setTitle(event.target.value)} />
            <p className="muted">{subtitle || "No stats selected"}</p>
          </div>

          <div className="panel-block">
            <div className="eyebrow">Grounding images</div>
            {(["schematic", "terrain", "streets", "satellite", "silhouette"] as GroundingKey[]).map((key) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={groundingOn[key]}
                  onChange={(event) => setGroundingOn((current) => ({ ...current, [key]: event.target.checked }))}
                />
                {key}
              </label>
            ))}
            <label className="poster-aspect">
              Aspect
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
                {ASPECTS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <div className="preview-grid">
              {groundingOn.schematic && previews.schematic && (
                <img className="poster-ref" src={previews.schematic} alt="Schematic grounding" />
              )}
              {groundingOn.silhouette && previews.silhouette && (
                <img className="poster-ref" src={previews.silhouette} alt="Route silhouette" />
              )}
              {groundingOn.terrain && previews.terrain && (
                <img className="poster-ref" src={previews.terrain} alt="Terrain grounding" />
              )}
            </div>
            {context.warnings.length ? <p className="muted">{context.warnings.join(" · ")}</p> : null}
          </div>

          <div className="panel-block">
            <button className="button" type="button" disabled={busy || !title.trim()} onClick={() => void handlePlan()}>
              {planning ? `Planning… ${elapsed}s` : spec ? "Re-plan" : "Plan prompt"}
            </button>
          </div>

          {spec && (
            <div className="panel-block">
              <SpecEditor spec={spec} onChange={setSpec} />
              <button className="button" type="button" disabled={busy} onClick={() => void handleGenerate()}>
                {generating ? `Generating… ${elapsed}s` : "Generate poster"}
              </button>
            </div>
          )}

          {result && (
            <div className="panel-block">
              <div className="eyebrow">Result</div>
              <img className="poster-result" src={result.url} alt={result.title} />
              <div className="poster-actions">
                <a className="button" href={result.url} download={`${result.posterId}.png`}>
                  Download
                </a>
                <a className="text-btn" href={result.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
              {result.cost != null && <p className="muted">Cost ${result.cost.toFixed(3)}</p>}
              <textarea
                className="poster-prompt"
                rows={3}
                placeholder="Refine: brighter trail, bigger title…"
                value={refineNotes}
                onChange={(event) => setRefineNotes(event.target.value)}
              />
              <button
                className="text-btn"
                type="button"
                disabled={busy || !refineNotes.trim()}
                onClick={() => void handlePlan()}
              >
                Re-plan with notes
              </button>
            </div>
          )}

          {history.length > 0 && (
            <div className="panel-block">
              <div className="eyebrow">Earlier posters</div>
              <div className="poster-thumbs">
                {history.map((item) => (
                  <button
                    key={item.posterId}
                    type="button"
                    className={item.posterId === result?.posterId ? "on" : ""}
                    onClick={() => {
                      setResult(item);
                      setSpec(item.spec);
                    }}
                  >
                    <img src={item.url} alt={item.title} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
