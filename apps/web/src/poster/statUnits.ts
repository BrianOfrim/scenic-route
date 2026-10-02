import type { FormattedStat } from "../api";

export type StatUnits = "metric" | "imperial";

export const DEFAULT_STAT_IDS = ["title", "date", "distance"];

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.280839895;
const MPH_PER_MPS = 2.2369362921;

export function distanceToMeters(value: number, units: StatUnits): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return value * (units === "imperial" ? METERS_PER_MILE : 1000);
}

export function statUnitsFrom(value: unknown): StatUnits {
  return value === "imperial" ? "imperial" : "metric";
}

export function formatDistance(meters: number | null | undefined, units: StatUnits): string {
  if (meters == null || !Number.isFinite(meters)) return "";
  if (units === "imperial") return `${(meters / METERS_PER_MILE).toFixed(1)} mi`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatElevation(meters: number | null | undefined, units: StatUnits): string {
  if (meters == null || !Number.isFinite(meters)) return "";
  if (units === "imperial") return `${Math.round(meters * FEET_PER_METER)} ft`;
  return `${Math.round(meters)} m`;
}

export function formatSpeed(metersPerSec: number | null | undefined, units: StatUnits): string {
  if (metersPerSec == null || !Number.isFinite(metersPerSec) || metersPerSec <= 0) return "";
  if (units === "imperial") return `${(metersPerSec * MPH_PER_MPS).toFixed(1)} mph`;
  return `${(metersPerSec * 3.6).toFixed(1)} km/h`;
}

type StatActivity = {
  distance: number;
  elevationGain: number | null;
  averageSpeed: number | null;
};

/** Rewrite distance, elevation, and speed. Other stats stay as stored. */
export function applyStatUnits(
  stats: FormattedStat[],
  activity: StatActivity | null | undefined,
  units: StatUnits,
): FormattedStat[] {
  if (!activity) return stats;
  return stats.flatMap((stat) => {
    const value =
      stat.id === "distance"
        ? formatDistance(activity.distance, units)
        : stat.id === "elevationGain"
          ? formatElevation(activity.elevationGain, units)
          : stat.id === "averageSpeed"
            ? formatSpeed(activity.averageSpeed, units)
            : stat.value;
    return value ? [{ ...stat, value }] : [];
  });
}
