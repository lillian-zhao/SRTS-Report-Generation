/**
 * Utilities for generating a static map image for the audit report.
 *
 * Two strategies, tried in order:
 *  1. If route geometry (polyline paths) is available, use the ArcGIS Online
 *     PrintingTools GP service to render the actual GPS route on a street basemap.
 *  2. Otherwise, geocode the school address via Nominatim (OpenStreetMap) and
 *     fetch a plain neighborhood basemap tile from ArcGIS World Street Map.
 */

import type { ArcGISFeature } from "./arcgis";

// ── Types ─────────────────────────────────────────────────────────────────────

type GeoPoint = { lat: number; lon: number };
type RoutePaths = number[][][]; // ArcGIS polyline paths: paths[path][vertex][lon,lat]

type PrintServiceResult = {
  results?: Array<{ paramName: string; value: { url: string } }>;
  error?: { message: string; details?: string[] };
};

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

// ── Strategy 1: Route map via ArcGIS PrintingTools ───────────────────────────

/**
 * Renders the GPS route polyline on a street basemap using the free ArcGIS
 * Online PrintingTools GP service. No API key required — basemap and print
 * service are public ESRI-hosted utilities.
 */
export async function fetchRouteMap(
  paths: RoutePaths,
  widthPx = 560,
  heightPx = 380,
): Promise<Uint8Array | null> {
  const bbox = routeBbox(paths);

  const webMapJson = {
    mapOptions: {
      showAttribution: false,
      extent: { spatialReference: { wkid: 4326 }, ...bbox },
    },
    operationalLayers: [
      {
        id: "route_layer",
        title: "Audit Route",
        opacity: 1,
        minScale: 0,
        maxScale: 0,
        featureCollection: {
          layers: [
            {
              layerDefinition: {
                geometryType: "esriGeometryPolyline",
                objectIdField: "OBJECTID",
                fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
              },
              featureSet: {
                geometryType: "esriGeometryPolyline",
                features: [
                  {
                    geometry: { paths, spatialReference: { wkid: 4326 } },
                    attributes: { OBJECTID: 1 },
                  },
                ],
              },
              drawingInfo: {
                renderer: {
                  type: "simple",
                  symbol: {
                    type: "esriSLS",
                    style: "esriSLSSolid",
                    color: [31, 78, 121, 230], // DOMI blue
                    width: 4,
                  },
                },
              },
            },
          ],
        },
      },
    ],
    baseMap: {
      baseMapLayers: [
        {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer",
          opacity: 1,
          visibility: true,
          title: "World Street Map",
        },
      ],
      title: "World Street Map",
    },
    exportOptions: { outputSize: [widthPx, heightPx], dpi: 96 },
  };

  const body = new URLSearchParams({
    f: "json",
    Web_Map_as_JSON: JSON.stringify(webMapJson),
    Format: "PNG32",
    Layout_Template: "MAP_ONLY",
  });

  const printUrl =
    "https://utility.arcgisonline.com/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute";

  console.log("[fetchRouteMap] Calling ArcGIS Print service...");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(printUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "SRTS-Walkability-Audit-Report-Generator/1.0 (pittsburghpa.gov)",
      },
      body: body.toString(),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.warn("[fetchRouteMap] Print service HTTP error:", response.status);
      return null;
    }

    const result = (await response.json()) as PrintServiceResult;

    if (result.error) {
      console.warn("[fetchRouteMap] Print service error:", result.error.message);
      return null;
    }

    const outputFile = result.results?.find((r) => r.paramName === "Output_File");
    if (!outputFile?.value?.url) {
      console.warn("[fetchRouteMap] No output URL:", JSON.stringify(result).slice(0, 300));
      return null;
    }

    console.log("[fetchRouteMap] Fetching image:", outputFile.value.url);
    const imgResp = await fetch(outputFile.value.url, { cache: "no-store" });
    if (!imgResp.ok) {
      console.warn("[fetchRouteMap] Image fetch failed:", imgResp.status);
      return null;
    }

    const buf = await imgResp.arrayBuffer();
    console.log("[fetchRouteMap] Success, size:", buf.byteLength);
    return new Uint8Array(buf);
  } catch (err) {
    console.warn("[fetchRouteMap] Failed:", String(err));
    return null;
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

/**
 * Main entry point. Tries to produce a map image using:
 *  1. Actual GPS route geometry (rendered with route in DOMI blue)
 *  2. Geocoded school address (plain neighborhood context map)
 *  3. null — caller falls back to text placeholder
 */
export async function fetchAuditMap(
  routePaths: RoutePaths | null,
  address: string,
): Promise<Uint8Array | null> {
  if (routePaths) {
    console.log("[fetchAuditMap] Using route geometry —", routePaths.flat().length, "vertices");
    const img = await fetchRouteMap(routePaths);
    if (img) return img;
    console.warn("[fetchAuditMap] Route map failed, falling back to geocoding");
  }

  console.log("[fetchAuditMap] Geocoding address:", address);
  const point = await geocodeAddress(address);
  if (!point) return null;
  return fetchStaticMapImage(point);
}

/** @deprecated Use fetchAuditMap instead */
export async function fetchSchoolAreaMap(address: string): Promise<Uint8Array | null> {
  return fetchAuditMap(null, address);
}
