/**
 * Utilities for generating a static map image centered on a school address.
 *
 * Two free, no-key-required services are used:
 *  1. Nominatim (OpenStreetMap) for geocoding the address to lat/lon.
 *  2. ArcGIS World Street Map export for the static basemap tile image.
 */

type GeoPoint = { lat: number; lon: number };

/**
 * Geocode a street address using the OpenStreetMap Nominatim service.
 * Returns null if the address cannot be resolved.
 */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
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
          // Nominatim requires a descriptive User-Agent per their usage policy
          "User-Agent": "SRTS-Walkability-Audit-Report-Generator/1.0 (pittsburghpa.gov)",
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) return null;

    const results = (await response.json()) as Array<{ lat: string; lon: string }>;
    if (!results.length) return null;

    return {
      lat: parseFloat(results[0].lat),
      lon: parseFloat(results[0].lon),
    };
  } catch (err) {
    console.warn("[geocodeAddress] Failed:", String(err));
    return null;
  }
}

/**
 * Fetch a static PNG map image centered on the given point.
 *
 * Uses the publicly accessible ArcGIS World Street Map export endpoint —
 * no authentication required.
 *
 * @param point   Lat/lon centre point
 * @param widthPx Image width in pixels (default 560)
 * @param heightPx Image height in pixels (default 380)
 * @param radiusDeg Half-side of the bounding box in degrees (default ~0.012° ≈ 0.8 miles)
 */
export async function fetchStaticMapImage(
  point: GeoPoint,
  widthPx = 560,
  heightPx = 380,
  radiusDeg = 0.013,
): Promise<Uint8Array | null> {
  const { lat, lon } = point;

  // Slightly wider longitude box because 1° lon < 1° lat at mid-latitudes
  const lonRadius = radiusDeg * 1.4;
  const bbox = [
    lon - lonRadius,
    lat - radiusDeg,
    lon + lonRadius,
    lat + radiusDeg,
  ].join(",");

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

  const url =
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export?${params.toString()}`;

  console.log("[fetchStaticMapImage] GET", url);

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      console.warn("[fetchStaticMapImage] Non-OK response:", response.status);
      return null;
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (err) {
    console.warn("[fetchStaticMapImage] Failed:", String(err));
    return null;
  }
}

/**
 * Convenience wrapper: geocode an address and return the static map image.
 * Returns null if either step fails (report falls back to text placeholder).
 */
export async function fetchSchoolAreaMap(address: string): Promise<Uint8Array | null> {
  if (!address?.trim()) return null;

  console.log("[fetchSchoolAreaMap] Geocoding:", address);
  const point = await geocodeAddress(address);
  if (!point) {
    console.warn("[fetchSchoolAreaMap] Could not geocode address:", address);
    return null;
  }

  console.log("[fetchSchoolAreaMap] Geocoded to", point.lat, point.lon);
  return fetchStaticMapImage(point);
}
