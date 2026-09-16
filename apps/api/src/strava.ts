import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth";
import { query, queryOne, withTransaction } from "./db";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API = "https://www.strava.com/api/v3";
const STATE_MAX_AGE_MS = 30 * 60 * 1000;

export type StravaTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: {
    id: number;
    firstname: string;
    lastname: string;
  };
};

export type SyncState = {
  listComplete: boolean;
  listPage: number;
};

export type StravaActivitySummary = {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  trainer: boolean;
  manual?: boolean;
  start_latlng?: number[];
  map?: { summary_polyline?: string | null };
};

export type StravaSegmentEffort = {
  name?: string;
  hidden?: boolean;
  distance?: number;
  start_index?: number;
  end_index?: number;
  segment?: {
    name?: string;
    activity_type?: string;
  };
};

type RateLimit = {
  shortLimit: number;
  dailyLimit: number;
  shortUsage: number;
  dailyUsage: number;
};

type ConnectionRow = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete_id: number | null;
  athlete: StravaTokens["athlete"] | null;
  sync_state: SyncState | null;
};

export class StravaRateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super("Strava rate limit reached");
    this.name = "StravaRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class StravaConfigError extends Error {
  constructor() {
    super("STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set in .env.local");
    this.name = "StravaConfigError";
  }
}

export class StravaAthleteTakenError extends Error {
  constructor() {
    super("This Strava account is already connected to another user");
    this.name = "StravaAthleteTakenError";
  }
}

function requireConfig() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const redirectUri =
    process.env.STRAVA_REDIRECT_URI ?? "http://localhost:5174/api/strava/callback";
  if (!clientId || !clientSecret) throw new StravaConfigError();
  return { clientId, clientSecret, redirectUri };
}

export function isStravaConfigured() {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

function rowToTokens(row: ConnectionRow | undefined): StravaTokens | null {
  if (!row) return null;
  return {
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expires_at: row.expires_at,
    athlete: row.athlete ?? undefined,
  };
}

export async function getTokens(userId: string) {
  const row = await queryOne<ConnectionRow>(
    `SELECT access_token, refresh_token, expires_at, athlete_id, athlete, sync_state
     FROM strava_connections WHERE user_id = $1`,
    [userId],
  );
  return rowToTokens(row);
}

export async function getSyncState(userId: string): Promise<SyncState> {
  const row = await queryOne<{ sync_state: SyncState | null }>(
    "SELECT sync_state FROM strava_connections WHERE user_id = $1",
    [userId],
  );
  return row?.sync_state ?? { listComplete: false, listPage: 1 };
}

export async function setSyncState(userId: string, state: SyncState) {
  await query("UPDATE strava_connections SET sync_state = $2::jsonb WHERE user_id = $1", [
    userId,
    JSON.stringify(state),
  ]);
}

export function signStravaState(userId: string, now = Date.now()) {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${userId}.${nonce}.${now}`;
  const sig = createHmac("sha256", authSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyStravaState(state: string, now = Date.now()): string {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new Error("invalid Strava state");
  }
  const parts = decoded.split(".");
  if (parts.length < 4) throw new Error("invalid Strava state");
  const sig = parts.pop()!;
  const issuedAt = Number(parts.pop());
  const nonce = parts.pop();
  const userId = parts.join(".");
  if (!userId || !nonce || !Number.isFinite(issuedAt)) throw new Error("invalid Strava state");
  if (now - issuedAt > STATE_MAX_AGE_MS) throw new Error("Strava state expired");
  const payload = `${userId}.${nonce}.${issuedAt}`;
  const expected = createHmac("sha256", authSecret()).update(payload).digest("hex");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("invalid Strava state");
  }
  return userId;
}

function parseRateLimit(headers: Headers): RateLimit {
  const limit = headers.get("X-RateLimit-Limit") ?? "100,1000";
  const usage = headers.get("X-RateLimit-Usage") ?? "0,0";
  const [shortLimit, dailyLimit] = limit.split(",").map((n) => Number(n) || 0);
  const [shortUsage, dailyUsage] = usage.split(",").map((n) => Number(n) || 0);
  return { shortLimit, dailyLimit, shortUsage, dailyUsage };
}

function assertBudget(limit: RateLimit) {
  if (limit.shortUsage >= limit.shortLimit - 2) {
    throw new StravaRateLimitError(15 * 60);
  }
  if (limit.dailyUsage >= limit.dailyLimit - 2) {
    throw new StravaRateLimitError(60 * 60);
  }
}

async function saveTokens(userId: string, tokens: StravaTokens, existing: StravaTokens | null) {
  const athlete = tokens.athlete ?? existing?.athlete;
  const athleteId = athlete?.id ?? null;
  if (athleteId != null) {
    const owner = await queryOne<{ user_id: string }>(
      "SELECT user_id FROM strava_connections WHERE athlete_id = $1",
      [athleteId],
    );
    if (owner && owner.user_id !== userId) throw new StravaAthleteTakenError();
  }
  await query(
    `INSERT INTO strava_connections (
       user_id, access_token, refresh_token, expires_at, athlete_id, athlete, sync_state
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE(
       (SELECT sync_state FROM strava_connections WHERE user_id = $1),
       '{}'::jsonb
     ))
     ON CONFLICT (user_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       athlete_id = EXCLUDED.athlete_id,
       athlete = EXCLUDED.athlete`,
    [
      userId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_at,
      athleteId,
      athlete ? JSON.stringify(athlete) : null,
    ],
  );
}

async function tokenRequest(userId: string, body: Record<string, string>) {
  const { clientId, clientSecret } = requireConfig();
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      ...body,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava token exchange failed: ${response.status} ${text}`);
  }
  const tokens = (await response.json()) as StravaTokens;
  const existing = await getTokens(userId);
  await saveTokens(userId, tokens, existing);
  return tokens;
}

export function getAuthorizeUrl(userId: string) {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state: signStravaState(userId),
  });
  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(userId: string, code: string) {
  return tokenRequest(userId, {
    code,
    grant_type: "authorization_code",
  });
}

async function refreshTokens(userId: string, tokens: StravaTokens) {
  return tokenRequest(userId, {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
}

async function getValidTokens(userId: string): Promise<StravaTokens> {
  const tokens = await getTokens(userId);
  if (!tokens) throw new Error("Strava is not connected");
  if (tokens.expires_at * 1000 < Date.now() + 60_000) {
    return refreshTokens(userId, tokens);
  }
  return tokens;
}

export async function stravaFetch<T>(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; rateLimit: RateLimit }> {
  const tokens = await getValidTokens(userId);
  const response = await fetch(`${STRAVA_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      ...(init.headers ?? {}),
    },
  });
  const rateLimit = parseRateLimit(response.headers);

  if (response.status === 401) {
    await refreshTokens(userId, tokens);
    return stravaFetch<T>(userId, path, init);
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? 900);
    throw new StravaRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 900);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava API ${path} failed: ${response.status} ${text}`);
  }
  assertBudget(rateLimit);
  return { data: (await response.json()) as T, rateLimit };
}

export async function getActivitySegmentEfforts(
  userId: string,
  activityId: number,
): Promise<StravaSegmentEffort[] | null> {
  if (!(await getTokens(userId))) return null;
  const { data } = await stravaFetch<{ segment_efforts?: StravaSegmentEffort[] }>(
    userId,
    `/activities/${activityId}?include_all_efforts=true`,
  );
  return data.segment_efforts ?? [];
}

export function activityHasGps(activity: StravaActivitySummary) {
  if (activity.trainer) return false;
  if (activity.sport_type === "VirtualRide" || activity.sport_type === "VirtualRun") {
    return false;
  }
  const polyline = activity.map?.summary_polyline;
  const start = activity.start_latlng;
  return Boolean(polyline) || (Array.isArray(start) && start.length >= 2);
}

/**
 * Unlink a user's Strava account. Removes the stored connection (tokens,
 * athlete, sync state) along with the activities that were synced from Strava,
 * while keeping manually uploaded activities (GPX/FIT/TCX). Clearing the synced
 * activities lets the user link a different Strava account without mixing rides
 * from the previous athlete. Returns the number of synced activities removed.
 */
export async function disconnectStrava(userId: string): Promise<{ removedActivities: number }> {
  return withTransaction(async (client) => {
    const removed = await client.query(
      `DELETE FROM activities
       WHERE user_id = $1
         AND COALESCE(imported, 0) = 0
         AND (source IS NULL OR source = 'strava')
         AND id < 2000000000000`,
      [userId],
    );
    await client.query("DELETE FROM strava_connections WHERE user_id = $1", [userId]);
    return { removedActivities: removed.rowCount ?? 0 };
  });
}
