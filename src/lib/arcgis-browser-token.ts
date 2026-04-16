/**
 * Request an ArcGIS token from the browser (same origin as the user’s normal
 * arcgis.com session). Server-side generateToken uses the server’s IP; Esri may
 * treat that differently than a browser request from your machine.
 */

function clientPortalBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_ARCGIS_PORTAL_URL ?? "https://www.arcgis.com";
  return raw.replace(/\/+$/, "");
}

function formatArcgisError(error?: { message?: string; details?: string[] }) {
  if (!error) return "Unknown ArcGIS error";
  if (error.details?.length) {
    return `${error.message ?? "ArcGIS error"} (${error.details.join(", ")})`;
  }
  return error.message ?? "Unknown ArcGIS error";
}

export type BrowserTokenResult =
  | { kind: "success"; token: string; expires?: number }
  | { kind: "auth"; message: string }
  | { kind: "useServer" };

/**
 * POST directly to ArcGIS from the browser. Returns `useServer` when the
 * request could not be completed in-browser (e.g. CORS/network), so the
 * caller can fall back to the API route.
 */
export async function tryGenerateTokenInBrowser(
  username: string,
  password: string,
): Promise<BrowserTokenResult> {
  const user = username.trim();
  const pass = password.trim();
  if (!user || !pass) {
    return { kind: "auth", message: "username and password are required" };
  }

  // Always use referer mode so the server (same referer header) can use the token.
  // requestip ties the token to the browser's IP; the server may have a different
  // network path and would get "Invalid token".
  const referer =
    process.env.NEXT_PUBLIC_ARCGIS_REFERER ?? window.location.origin;

  const formData = new URLSearchParams({
    username: user,
    password: pass,
    expiration: "120",
    f: "json",
    client: "referer",
    referer,
  });

  const portal = clientPortalBaseUrl();
  const url = `${portal}/sharing/rest/generateToken`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
    });

    const payload = (await response.json()) as {
      token?: string;
      expires?: number;
      error?: { message?: string; details?: string[] };
    };

    if (payload.token) {
      return {
        kind: "success",
        token: payload.token,
        expires: payload.expires,
      };
    }

    return {
      kind: "auth",
      message: formatArcgisError(payload.error),
    };
  } catch {
    return { kind: "useServer" };
  }
}
