const METERS_PER_MILE = 1609.344;
/** A poster distance this far from the activity is a different route, not a crop or rounding. */
const DISTANCE_RATIO_MIN = 0.67;
const DISTANCE_RATIO_MAX = 1.5;

export type RebindPoster = {
  posterId: string;
  activityId: number;
  title: string;
  subtitle: string;
};

export type RebindActivity = {
  id: number;
  name: string;
  distance: number;
};

export function subtitleDistanceMeters(subtitle: string): number | null {
  const km = subtitle.match(/(\d+(?:\.\d+)?)\s*km(?!\/)/i);
  if (km) {
    const meters = Number(km[1]) * 1000;
    return Number.isFinite(meters) ? meters : null;
  }
  const miles = subtitle.match(/(\d+(?:\.\d+)?)\s*mi\b/i);
  if (miles) {
    const meters = Number(miles[1]) * METERS_PER_MILE;
    return Number.isFinite(meters) ? meters : null;
  }
  return null;
}

function norm(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function groupKey(poster: RebindPoster) {
  return `${poster.activityId}\0${norm(poster.title)}`;
}

/** True when the subtitle distance is close to the activity, false when it is a different route, null when unknown. */
function distanceAgrees(poster: RebindPoster, activity: RebindActivity): boolean | null {
  const meters = subtitleDistanceMeters(poster.subtitle);
  if (meters == null || !(activity.distance > 0)) return null;
  const ratio = meters / activity.distance;
  return ratio >= DISTANCE_RATIO_MIN && ratio <= DISTANCE_RATIO_MAX;
}

function mismatches(poster: RebindPoster, activity: RebindActivity) {
  if (norm(poster.title) === norm(activity.name)) return false;
  return distanceAgrees(poster, activity) === false;
}

function matchingActivity(group: RebindPoster[], activities: RebindActivity[], currentId: number) {
  const title = norm(group[0]?.title ?? "");
  const viable = activities.filter((activity) => {
    if (activity.id === currentId || norm(activity.name) !== title) return false;
    return group.every((poster) => distanceAgrees(poster, activity) !== false);
  });
  if (viable.length === 1) return viable[0].id;
  const known = group
    .map((poster) => subtitleDistanceMeters(poster.subtitle))
    .filter((meters): meters is number => meters != null);
  if (viable.length > 1 && known.length) {
    const mean = known.reduce((sum, meters) => sum + meters, 0) / known.length;
    viable.sort((a, b) => Math.abs(a.distance - mean) - Math.abs(b.distance - mean));
    return viable[0].id;
  }
  return null;
}

/**
 * Posters whose distance shows they were made for a previous occupant of this activity id.
 * Same-title siblings stay together. An exact title match can move onto that activity;
 * everything else gets a fresh id from `allocate`.
 */
export function planPosterActivityRebind(
  posters: RebindPoster[],
  activities: RebindActivity[],
  allocate: () => number,
): Map<string, number> {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const orphanKeys = new Set<string>();
  for (const poster of posters) {
    const activity = byId.get(poster.activityId);
    if (!activity || !mismatches(poster, activity)) continue;
    orphanKeys.add(groupKey(poster));
  }

  const groups = new Map<string, RebindPoster[]>();
  for (const poster of posters) {
    const key = groupKey(poster);
    if (!orphanKeys.has(key)) continue;
    const group = groups.get(key) ?? [];
    group.push(poster);
    groups.set(key, group);
  }

  const updates = new Map<string, number>();
  for (const group of groups.values()) {
    const currentId = group[0].activityId;
    const nextId = matchingActivity(group, activities, currentId) ?? allocate();
    if (nextId === currentId) continue;
    for (const poster of group) updates.set(poster.posterId, nextId);
  }
  return updates;
}
