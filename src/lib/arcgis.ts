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

type ArcGISServiceInfoResponse = {
  layers?: Array<{ id: number; name: string }>;
  tables?: Array<{ id: number; name: string }>;
  error?: {
    message?: string;
    details?: string[];
  };
};

export type PhotoAttachment = {
  id: number;
  name: string;
  contentType: string;
  size: number;
  url: string;
  parentGlobalId: string;
  tableLayerId: number;
  tableName: string;
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
  returnGeometry = false,
) {
  const body = new URLSearchParams({
    f: "json",
    where,
    outFields,
    returnGeometry: String(returnGeometry),
    token,
  });

  const queryUrl = `${layerUrl}/query`;
  console.log("[queryLayerFeatures] POST", queryUrl, "where:", where, "outFields:", outFields);

  const response = await fetch(queryUrl, {
    method: "POST",
    headers: {
      ...arcgisRequestHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
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
 * ArcGIS Online hosted feature services require proper SQL DATE syntax in
 * WHERE clauses; raw epoch-ms integers are rejected. We convert the stored
 * epoch value to a full-day range: date >= DATE 'Y-M-D' AND date < DATE 'Y-M-D+1'.
 */
export function buildDateClause(dateField: string, surveyDate: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  const epochMs = Number(surveyDate.trim());
  if (Number.isFinite(epochMs) && epochMs > 1_000_000_000_000) {
    const d = new Date(epochMs);
    const next = new Date(epochMs + 86_400_000);
    const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const nextStr = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
    const clause = `${dateField} >= DATE '${dateStr}' AND ${dateField} < DATE '${nextStr}'`;
    console.log("[buildDateClause]", clause);
    return clause;
  }
  const escaped = surveyDate.replace(/'/g, "''");
  const clause = `${dateField} = DATE '${escaped}'`;
  console.log("[buildDateClause]", clause);
  return clause;
}

/** Human-readable date string from an epoch-ms or ISO string. */
export function formatSurveyDate(surveyDate: string): string {
  const epochMs = Number(surveyDate.trim());
  if (Number.isFinite(epochMs) && epochMs > 1_000_000_000_000) {
    return new Date(epochMs).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
    });
  }
  return surveyDate;
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

/**
 * Returns a WHERE clause that filters only by school name — no date restriction.
 * Used when the same audit may have records submitted across different dates
 * (coordinator, planner, and traffic team often submit on different days).
 */
export function buildSchoolOnlyClause(school: string, schoolField: string): string {
  const escaped = school.replace(/'/g, "''");
  return `${schoolField} = '${escaped}'`;
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
  const body = new URLSearchParams({
    f: "json",
    token,
    objectIds: objectIds.join(","),
  });

  const queryUrl = `${serviceUrl}/${layerId}/queryAttachments`;
  console.log("[queryLayerAttachments] POST", queryUrl, "objectIds:", objectIds.join(","));

  const response = await fetch(queryUrl, {
    method: "POST",
    headers: {
      ...arcgisRequestHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const payload = (await response.json()) as ArcGISAttachmentsResponse;
  console.log("[queryLayerAttachments] response:", JSON.stringify(payload).slice(0, 300));

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

/**
 * Fetch the FeatureServer metadata to discover all layers and related tables.
 */
export async function getServiceInfo(layerUrl: string, token: string) {
  const { serviceUrl } = parseLayerUrl(layerUrl);
  const params = new URLSearchParams({ f: "json", token });
  console.log("[getServiceInfo] GET", serviceUrl);
  const response = await fetch(`${serviceUrl}?${params.toString()}`, {
    method: "GET",
    headers: arcgisRequestHeaders(),
    cache: "no-store",
  });
  const payload = (await response.json()) as ArcGISServiceInfoResponse;
  if (!response.ok || payload.error) {
    throw new Error(arcgisErrorMessage(payload.error));
  }
  console.log(
    "[getServiceInfo] layers:", JSON.stringify(payload.layers),
    "tables:", JSON.stringify(payload.tables),
  );
  return payload;
}

/**
 * Survey123 stores photo-question images in related tables (one per image question),
 * not as direct feature attachments on the main layer.
 *
 * This function:
 * 1. Fetches the service metadata to discover all related tables.
 * 2. For each table, queries for records where parentglobalid matches any of our
 *    main feature globalids.
 * 3. Collects attachments from those related-table records.
 *
 * Returns a flat array of PhotoAttachment objects, each with a ready-to-use URL.
 */
export async function queryRelatedPhotoAttachments(
  layerUrl: string,
  token: string,
  mainFeatureGlobalIds: string[],
): Promise<PhotoAttachment[]> {
  if (!mainFeatureGlobalIds.length) return [];

  const { serviceUrl } = parseLayerUrl(layerUrl);

  // 1. Get all tables in the service
  const serviceInfo = await getServiceInfo(layerUrl, token);
  const allTables = [
    ...(serviceInfo.layers ?? []),
    ...(serviceInfo.tables ?? []),
  ];

  // Filter out layer 0 (main feature layer) — only check related tables/sublayers
  const relatedTables = allTables.filter((t) => t.id !== 0);
  if (!relatedTables.length) {
    console.log("[queryRelatedPhotoAttachments] No related tables found.");
    return [];
  }

  const globalIdList = mainFeatureGlobalIds
    .map((gid) => `'${gid}'`)
    .join(",");
  const where = `parentglobalid IN (${globalIdList})`;

  const allPhotos: PhotoAttachment[] = [];

  for (const table of relatedTables) {
    const tableUrl = `${serviceUrl}/${table.id}`;
    console.log("[queryRelatedPhotoAttachments] Querying table", table.id, table.name);

    // Query records in this table that have a matching parentglobalid
    let tableRecords: ArcGISFeature[] = [];
    try {
      tableRecords = await queryLayerFeatures(tableUrl, token, where);
    } catch (err) {
      console.warn("[queryRelatedPhotoAttachments] Skipping table", table.id, String(err));
      continue;
    }

    if (!tableRecords.length) continue;

    // Get the objectIds of the matching table records
    const tableObjectIds = tableRecords
      .map((r) => Number(r.attributes["objectid"] ?? r.attributes["OBJECTID"]))
      .filter((id) => Number.isFinite(id));

    if (!tableObjectIds.length) continue;

    // Query attachments on those table records
    const attachBody = new URLSearchParams({
      f: "json",
      token,
      objectIds: tableObjectIds.join(","),
    });
    const attachUrl = `${serviceUrl}/${table.id}/queryAttachments`;
    console.log("[queryRelatedPhotoAttachments] queryAttachments on table", table.id, "objectIds:", tableObjectIds.join(","));

    let attachPayload: ArcGISAttachmentsResponse;
    try {
      const attachResponse = await fetch(attachUrl, {
        method: "POST",
        headers: {
          ...arcgisRequestHeaders(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: attachBody.toString(),
        cache: "no-store",
      });
      attachPayload = (await attachResponse.json()) as ArcGISAttachmentsResponse;
      console.log("[queryRelatedPhotoAttachments] table", table.id, "attachmentGroups count:", attachPayload.attachmentGroups?.length ?? 0);
    } catch (err) {
      console.warn("[queryRelatedPhotoAttachments] Attachment query failed for table", table.id, String(err));
      continue;
    }

    if (attachPayload.error || !attachPayload.attachmentGroups?.length) continue;

    for (const group of attachPayload.attachmentGroups) {
      // Find the parent globalid for this table record
      const tableRecord = tableRecords.find(
        (r) =>
          Number(r.attributes["objectid"] ?? r.attributes["OBJECTID"]) === group.parentObjectId,
      );
      const parentGlobalId = String(tableRecord?.attributes["parentglobalid"] ?? tableRecord?.attributes["PARENTGLOBALID"] ?? "");

      for (const att of group.attachmentInfos) {
        if (!att.contentType.startsWith("image/")) continue;
        allPhotos.push({
          id: att.id,
          name: att.name,
          contentType: att.contentType,
          size: att.size,
          url:
            att.url ??
            `${serviceUrl}/${table.id}/${group.parentObjectId}/attachments/${att.id}?token=${encodeURIComponent(token)}`,
          parentGlobalId,
          tableLayerId: table.id,
          tableName: table.name,
        });
      }
    }
  }

  console.log("[queryRelatedPhotoAttachments] Total photos found:", allPhotos.length);
  return allPhotos;
}

export function getSurveyConfig() {
  return {
    preSurveyLayerUrl: requiredEnv("ARCGIS_PRE_SURVEY_LAYER_URL"),
    postSurveyLayerUrl: requiredEnv("ARCGIS_POST_SURVEY_LAYER_URL"),
    schoolField: process.env.ARCGIS_SCHOOL_FIELD ?? "which_school_is_this_audit_for",
    postSchoolField: process.env.ARCGIS_POST_SCHOOL_FIELD ?? "field_103",
    dateField: process.env.ARCGIS_DATE_FIELD ?? "date_of_audit",
    objectIdField: process.env.ARCGIS_OBJECTID_FIELD ?? "objectid",
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
