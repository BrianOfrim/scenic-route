export function formatKm(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return "";
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m} min`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatSpeed(metersPerSec: number | null | undefined): string {
  if (metersPerSec == null || !Number.isFinite(metersPerSec) || metersPerSec <= 0) return "";
  return `${(metersPerSec * 3.6).toFixed(1)} km/h`;
}

export function formatElevation(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return "";
  return `${Math.round(meters)} m`;
}
