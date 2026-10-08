/**
 * Map provider abstraction. The demo uses public OpenStreetMap raster tiles (no API key).
 * To switch to a commercial provider (Mapbox, HERE, Google, self-hosted tiles) change these env vars only:
 *   VITE_MAP_TILE_URL, VITE_MAP_ATTRIBUTION
 * NOTE: OSM's public tile server has a fair-use policy; use a proper tile provider for production traffic.
 */
export const mapProvider = {
  tileUrl: (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  defaultCenter: [33.6, 72.6] as [number, number],
  defaultZoom: 7,
};
