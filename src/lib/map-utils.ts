/**
 * Utilities for generating a static map image for the audit report.
 *
 * Two strategies, tried in order:
 *  1. If route geometry (polyline paths) is available, fetch the ArcGIS World
 *     Street Map basemap scoped to the route bounding box, then composite the
 *     GPS polyline on top using sharp (server-side PNG compositing).
 *  2. Otherwise, geocode the school address via Nominatim (OpenStreetMap) and
 *     fetch a plain neighbourhood basemap tile from ArcGIS World Street Map.
 */

import sharp from "sharp";
import type { ArcGISFeature } from "./arcgis";

// ── Types ─────────────────────────────────────────────────────────────────────

type GeoPoint = { lat: number; lon: number };
type RoutePaths = number[][][]; // ArcGIS polyline paths: paths[path][vertex][lon,lat]

// ── Route geometry helpers ────────────────────────────────────────────────────

/**
 * Finds the first feature in the array that has polyline path geometry and
 * returns its paths array, or null if none found.
 */
export function extractRouteGeometry(features: ArcGISFeature[]): RoutePaths | null {
  for (const feature of features) {
    const geo = feature.geometry as Record<string, unknown> | undefined;
    if (!geo) continue;
    const paths = geo["paths"] as RoutePaths | undefined;
    if (Array.isArray(paths) && paths.length > 0 && Array.isArray(paths[0]) && paths[0].length > 1) {
      return paths;
    }
  }
  return null;
}

function routeBbox(paths: RoutePaths, paddingFactor = 0.18) {
  const allPoints = paths.flat();
  let minLon = allPoints[0][0], maxLon = allPoints[0][0];
  let minLat = allPoints[0][1], maxLat = allPoints[0][1];

  for (const [lon, lat] of allPoints) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  const lonPad = Math.max((maxLon - minLon) * paddingFactor, 0.004);
  const latPad = Math.max((maxLat - minLat) * paddingFactor, 0.003);

  return {
    xmin: minLon - lonPad,
    ymin: minLat - latPad,
    xmax: maxLon + lonPad,
    ymax: maxLat + latPad,
  };
}

// ── Strategy 1: Route map — basemap PNG + sharp polyline overlay ─────────────

/**
 * Fetches the ArcGIS World Street Map basemap PNG scoped to the GPS route's
 * bounding box, then uses `sharp` to composite the route polyline on top.
 * Returns a single PNG with the route drawn in DOMI blue with a white halo.
 */
export async function fetchRouteMap(
  paths: RoutePaths,
  widthPx = 560,
  heightPx = 380,
): Promise<AuditMapResult | null> {
  const bbox = routeBbox(paths);

  // 1. Fetch the street basemap PNG
  const mapParams = new URLSearchParams({
    bbox: `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`,
    bboxSR: "4326",
    size: `${widthPx},${heightPx}`,
    imageSR: "4326",
    format: "png32",
    transparent: "false",
    dpi: "96",
    f: "image",
  });

  let basemapBuf: Buffer | null = null;
  try {
    const resp = await fetch(
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export?${mapParams.toString()}`,
      { cache: "no-store" },
    );
    if (resp.ok) {
      basemapBuf = Buffer.from(await resp.arrayBuffer());
      console.log("[fetchRouteMap] Basemap fetched, size:", basemapBuf.byteLength);
    } else {
      console.warn("[fetchRouteMap] Basemap fetch failed:", resp.status);
    }
  } catch (err) {
    console.warn("[fetchRouteMap] Basemap error:", String(err));
  }

  if (!basemapBuf) return null;

  // 2. Project GPS coordinates → pixel space (equirectangular, fine for city scale)
  const { xmin, ymin, xmax, ymax } = bbox;
  const toPixel = ([lon, lat]: number[]) => {
    const x = ((lon - xmin) / (xmax - xmin)) * widthPx;
    const y = (1 - (lat - ymin) / (ymax - ymin)) * heightPx;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const pointsStr = paths.flat().map(toPixel).join(" ");

  // 3. Build a route-only SVG (transparent background — just the polyline)
  const svgOverlay = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}">`,
    // White halo for legibility against light/dark tiles
    `  <polyline points="${pointsStr}" fill="none" stroke="#FFFFFF" stroke-width="7"`,
    `    stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`,
    // DOMI blue route line
    `  <polyline points="${pointsStr}" fill="none" stroke="#1F4E79" stroke-width="4.5"`,
    `    stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`,
    // Start dot
    `  <circle cx="${toPixel(paths[0][0]).split(",")[0]}" cy="${toPixel(paths[0][0]).split(",")[1]}" r="7" fill="#1F4E79" stroke="#FFFFFF" stroke-width="2"/>`,
    // End dot
    `  <circle cx="${toPixel(paths[paths.length - 1][paths[paths.length - 1].length - 1]).split(",")[0]}" cy="${toPixel(paths[paths.length - 1][paths[paths.length - 1].length - 1]).split(",")[1]}" r="7" fill="#C00000" stroke="#FFFFFF" stroke-width="2"/>`,
    `</svg>`,
  ].join("\n");

  // 4. Composite the SVG overlay onto the basemap PNG using sharp
  try {
    const compositedBuf = await sharp(basemapBuf)
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .png()
      .toBuffer();
    console.log("[fetchRouteMap] Route composited successfully, size:", compositedBuf.byteLength);
    return { image: new Uint8Array(compositedBuf), type: "png" };
  } catch (err) {
    console.warn("[fetchRouteMap] sharp composite failed, returning plain basemap:", String(err));
    return { image: new Uint8Array(basemapBuf), type: "png" };
  }
}

// ── Strategy 2: Neighborhood map via Nominatim + ArcGIS tile export ───────────

async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  if (!address?.trim()) return null;

  const params = new URLSearchParams({
    q: address,
    format: "json",
    limit: "1",
    countrycodes: "us",
  });

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          "User-Agent": "SRTS-Walkability-Audit-Report-Generator/1.0 (pittsburghpa.gov)",
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const results = (await response.json()) as Array<{ lat: string; lon: string }>;
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}

async function fetchStaticMapImage(
  point: GeoPoint,
  widthPx = 560,
  heightPx = 380,
  radiusDeg = 0.013,
): Promise<Uint8Array | null> {
  const { lat, lon } = point;
  const lonRadius = radiusDeg * 1.4;
  const bbox = [lon - lonRadius, lat - radiusDeg, lon + lonRadius, lat + radiusDeg].join(",");

  const params = new URLSearchParams({
    bbox,
    bboxSR: "4326",
    size: `${widthPx},${heightPx}`,
    imageSR: "4326",
    format: "png32",
    transparent: "false",
    dpi: "96",
    f: "image",
  });

  try {
    const response = await fetch(
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export?${params.toString()}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export type AuditMapResult = {
  image: Uint8Array;
  /** "svg" = GPS route drawn; "png" = plain neighbourhood basemap */
  type: "svg" | "png";
  /** Raster fallback required by docx when type is "svg" */
  fallbackPng?: Uint8Array;
};

/**
 * Main entry point. Tries to produce a map using:
 *  1. Actual GPS route geometry (SVG with route in DOMI blue + PNG fallback)
 *  2. Geocoded school address (plain PNG basemap)
 *  3. null — caller renders a text placeholder
 */
export async function fetchAuditMap(
  routePaths: RoutePaths | null,
  address: string,
): Promise<AuditMapResult | null> {
  if (routePaths) {
    console.log("[fetchAuditMap] Using route geometry —", routePaths.flat().length, "vertices");
    const result = await fetchRouteMap(routePaths);
    if (result) return result;
    console.warn("[fetchAuditMap] Route map failed, falling back to geocoding");
  }

  console.log("[fetchAuditMap] Geocoding address:", address);
  const point = await geocodeAddress(address);
  if (!point) return null;
  const png = await fetchStaticMapImage(point);
  if (!png) return null;
  return { image: png, type: "png" };
}

/** @deprecated Use fetchAuditMap instead */
export async function fetchSchoolAreaMap(address: string): Promise<AuditMapResult | null> {
  return fetchAuditMap(null, address);
}
