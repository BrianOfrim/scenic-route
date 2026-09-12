import { getActivity, getCachedSegmentEfforts, setCachedSegmentEfforts } from "./activities";
import { getActivitySegmentEfforts, StravaRateLimitError, type StravaSegmentEffort } from "./strava";

export async function loadActivitySegmentEfforts(
  activityId: number,
  warnings: string[],
): Promise<StravaSegmentEffort[]> {
  const row = getActivity(activityId);
  if (!row || row.source === "gpx" || row.source === "fit" || row.source === "tcx") return [];
  const cached = getCachedSegmentEfforts(row) as StravaSegmentEffort[] | null;
  if (cached) return cached;
  try {
    const fetched = await getActivitySegmentEfforts(activityId);
    if (!fetched) return [];
    setCachedSegmentEfforts(activityId, fetched);
    return fetched;
  } catch (error) {
    if (error instanceof StravaRateLimitError) {
      warnings.push("Strava rate limit reached; trail names from segments will retry later");
      return [];
    }
    warnings.push(error instanceof Error ? error.message : "Strava segment lookup failed");
    return [];
  }
}
