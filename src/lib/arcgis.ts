function getPortalBaseUrl(): string {
  const raw = process.env.ARCGIS_PORTAL_URL ?? "https://www.arcgis.com";
  return raw.replace(/\/+$/, "");
}

type ArcGISTokenResponse = {
  token?: string;
  expires?: number;
  error?: {
    message?: string;
    details?: string[];
  };
};

type ArcGISQueryResponse<T> = {
  features?: T[];
  error?: {
    message?: string;
    details?: string[];
  };
};

type ArcGISAttachmentsResponse = {
  attachmentGroups?: Array<{
    parentObjectId: number;
    attachmentInfos: Array<{
      id: number;
      name: string;
      contentType: string;
      size: number;
      url?: string;
    }>;
  }>;
  error?: {
    message?: string;
    details?: string[];
  };
};

export type ArcGISFeature = {
  attributes: Record<string, string | number | null>;
  geometry?: Record<string, unknown>;
};

type ArcGISOAuthTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: {
    message?: string;
    details?: string[];
  };
};

type ArcGISLayerMetadataResponse = {
  fields?: Array<{
    name: string;
    alias?: string;
    type?: string;
  }>;
  error?: {
    message?: string;
    details?: string[];
  };
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function arcgisErrorMessage(error?: { message?: string; details?: string[] }) {
  if (!error) return "Unknown ArcGIS error";
  if (error.details?.length) {
    return `${error.message ?? "ArcGIS error"} (${error.details.join(", ")})`;
  }
  return error.message ?? "Unknown ArcGIS error";
}

export async function generateUserToken(username: string, password: string) {
  const tokenClient = process.env.ARCGIS_TOKEN_CLIENT ?? "requestip";
  const user = username.trim();
  const pass = password.trim();
  if (!user || !pass) {
    throw new Error("username and password are required");
  }

  const formData = new URLSearchParams({
    username: user,
    password: pass,
    expiration: "120",
    f: "json",
  });

  // ArcGIS supports multiple token "client" modes. Many orgs block the referer-based
  // flow unless the referer matches a configured allow-list.
  //
  // Common values:
  // - "referer"   (expects `referer` param)
  // - "requestip" (no referer required)
  if (tokenClient === "referer") {
    formData.set("referer", process.env.ARCGIS_REFERER ?? "http://localhost:3000");
    formData.set("client", "referer");
  } else {
    formData.set("client", "requestip");
  }

  const portal = getPortalBaseUrl();
  const response = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Some environments treat bare Node/edge fetch as non-browser traffic.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
    },
    body: formData,
    cache: "no-store",
  });

  const payload = (await response.json()) as ArcGISTokenResponse;
  if (!response.ok || payload.error || !payload.token) {
    throw new Error(arcgisErrorMessage(payload.error));
  }

  return {
    token: payload.token,
    expires: payload.expires ?? Date.now() + 2 * 60 * 60 * 1000,
  };
}

function arcgisRequestHeaders() {
  return {
    Referer: process.env.ARCGIS_REFERER ?? "http://localhost:3000",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
  };
}

export async function queryLayerFeatures(
  layerUrl: string,
  token: string,
  where: string,
  outFields = "*",
) {
  const params = new URLSearchParams({
    f: "json",
    where,
    outFields,
    returnGeometry: "true",
    token,
  });

  const queryUrl = `${layerUrl}/query?${params.toString()}`;
  console.log("[queryLayerFeatures] url:", queryUrl.replace(/token=[^&]+/, "token=REDACTED"));

  const response = await fetch(queryUrl, {
    method: "GET",
    headers: arcgisRequestHeaders(),
    cache: "no-store",
  });

  const payload = (await response.json()) as ArcGISQueryResponse<ArcGISFeature>;
  if (!response.ok || payload.error) {
    console.error("[queryLayerFeatures] ArcGIS error response:", JSON.stringify(payload));
    throw new Error(arcgisErrorMessage(payload.error));
  }

  return payload.features ?? [];
}

export async function getLayerFields(layerUrl: string, token: string) {
  const params = new URLSearchParams({
    f: "json",
    token,
  });

  const response = await fetch(`${layerUrl}?${params.toString()}`, {
    method: "GET",
    headers: arcgisRequestHeaders(),
    cache: "no-store",
  });
  const payload = (await response.json()) as ArcGISLayerMetadataResponse;

  if (!response.ok || payload.error) {
    throw new Error(arcgisErrorMessage(payload.error));
  }

  return payload.fields ?? [];
}

/**
 * ArcGIS Online hosted feature services require proper SQL date strings in
 * WHERE clauses; raw epoch-ms integers are rejected with "Invalid query
 * parameters". We convert the epoch value (returned by the layer query) to
 * a full-day TIMESTAMP range in UTC.
 */
export function buildDateClause(dateField: string, surveyDate: string): string {
  const epochMs = Number(surveyDate.trim());
  if (Number.isFinite(epochMs) && epochMs > 1_000_000_000_000) {
    const d = new Date(epochMs);
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = d.getUTCFullYear();
    const m = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    const dateStr = `${y}-${m}-${day}`;
    const clause = `${dateField} >= DATE '${dateStr}' AND ${dateField} < DATE '${dateStr}' + INTERVAL '1' DAY`;
    console.log("[buildDateClause]", clause);
    return clause;
  }
  const escaped = surveyDate.replace(/'/g, "''");
  const clause = `${dateField} = DATE '${escaped}'`;
  console.log("[buildDateClause]", clause);
  return clause;
}

export function buildWhereClause(
  school: string,
  surveyDate: string,
  schoolField: string,
  dateField: string,
) {
  const escapedSchool = school.replace(/'/g, "''");
  const dateClause = buildDateClause(dateField, surveyDate);
  return `${schoolField} = '${escapedSchool}' AND ${dateClause}`;
}

function parseLayerUrl(layerUrl: string) {
  const match = layerUrl.match(/(.+\/FeatureServer)\/(\d+)\/?$/i);
  if (!match) {
    throw new Error(
      `Layer URL must end in /FeatureServer/<layerId>. Received: ${layerUrl}`,
    );
  }

  return {
    serviceUrl: match[1],
    layerId: match[2],
  };
}

export async function queryLayerAttachments(
  layerUrl: string,
  token: string,
  objectIds: number[],
) {
  if (!objectIds.length) {
    return {};
  }

  const { serviceUrl, layerId } = parseLayerUrl(layerUrl);
  const params = new URLSearchParams({
    f: "json",
    token,
    objectIds: objectIds.join(","),
    definitionExpression: "1=1",
    attachmentTypes: "",
    keywords: "",
  });

  const response = await fetch(
    `${serviceUrl}/${layerId}/queryAttachments?${params.toString()}`,
    {
      method: "GET",
      headers: arcgisRequestHeaders(),
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as ArcGISAttachmentsResponse;

  if (!response.ok || payload.error) {
    throw new Error(arcgisErrorMessage(payload.error));
  }

  return Object.fromEntries(
    (payload.attachmentGroups ?? []).map((group) => [
      group.parentObjectId,
      group.attachmentInfos.map((attachment) => ({
        ...attachment,
        url:
          attachment.url ??
          `${serviceUrl}/${layerId}/${group.parentObjectId}/attachments/${attachment.id}?token=${encodeURIComponent(token)}`,
      })),
    ]),
  );
}

export function getSurveyConfig() {
  return {
    preSurveyLayerUrl: requiredEnv("ARCGIS_PRE_SURVEY_LAYER_URL"),
    postSurveyLayerUrl: requiredEnv("ARCGIS_POST_SURVEY_LAYER_URL"),
    schoolField: process.env.ARCGIS_SCHOOL_FIELD ?? "school_name",
    dateField: process.env.ARCGIS_DATE_FIELD ?? "survey_date",
    objectIdField: process.env.ARCGIS_OBJECTID_FIELD ?? "OBJECTID",
  };
}

export function getArcGISOAuthConfig() {
  const portalUrl = getPortalBaseUrl();
  const clientId = requiredEnv("ARCGIS_CLIENT_ID");
  const redirectUri =
    process.env.ARCGIS_OAUTH_REDIRECT_URI ??
    "http://localhost:3000/api/arcgis/oauth/callback";

  return {
    portalUrl,
    clientId,
    clientSecret: process.env.ARCGIS_CLIENT_SECRET,
    redirectUri,
  };
}

export async function exchangeOAuthCodeForToken(code: string) {
  const oauth = getArcGISOAuthConfig();
  const formData = new URLSearchParams({
    f: "json",
    client_id: oauth.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: oauth.redirectUri,
  });

  if (oauth.clientSecret) {
    formData.set("client_secret", oauth.clientSecret);
  }

  const response = await fetch(`${oauth.portalUrl}/sharing/rest/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
    cache: "no-store",
  });

  const payload = (await response.json()) as ArcGISOAuthTokenResponse;
  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(arcgisErrorMessage(payload.error));
  }

  return {
    token: payload.access_token,
    expires:
      Date.now() + (payload.expires_in ? payload.expires_in * 1000 : 2 * 60 * 60 * 1000),
  };
}
