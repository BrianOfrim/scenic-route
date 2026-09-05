import { getDb, getJsonSetting, setJsonSetting } from "./db";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API = "https://www.strava.com/api/v3";

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

type RateLimit = {
  shortLimit: number;
  dailyLimit: number;
  shortUsage: number;
  dailyUsage: number;
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

export function getTokens() {
  return getJsonSetting<StravaTokens>("strava_tokens");
}

export function getSyncState(): SyncState {
  return (
    getJsonSetting<SyncState>("sync_state") ?? {
      listComplete: false,
      listPage: 1,
    }
  );
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

async function tokenRequest(body: Record<string, string>) {
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
  setJsonSetting("strava_tokens", {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    athlete: tokens.athlete ?? getTokens()?.athlete,
  });
  return tokens;
}

export function getAuthorizeUrl() {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
  });
  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string) {
  return tokenRequest({
    code,
    grant_type: "authorization_code",
  });
}

async function refreshTokens(tokens: StravaTokens) {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
}

async function getValidTokens(): Promise<StravaTokens> {
  const tokens = getTokens();
  if (!tokens) throw new Error("Strava is not connected");
  if (tokens.expires_at * 1000 < Date.now() + 60_000) {
    return refreshTokens(tokens);
  }
  return tokens;
}

export async function stravaFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; rateLimit: RateLimit }> {
  const tokens = await getValidTokens();
  const response = await fetch(`${STRAVA_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      ...(init.headers ?? {}),
    },
  });
  const rateLimit = parseRateLimit(response.headers);

  if (response.status === 401) {
    await refreshTokens(tokens);
    return stravaFetch<T>(path, init);
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

export function activityHasGps(activity: StravaActivitySummary) {
  if (activity.trainer) return false;
  if (activity.sport_type === "VirtualRide" || activity.sport_type === "VirtualRun") {
    return false;
  }
  const polyline = activity.map?.summary_polyline;
  const start = activity.start_latlng;
  return Boolean(polyline) || (Array.isArray(start) && start.length >= 2);
}

export function disconnectStrava() {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run("strava_tokens");
}
