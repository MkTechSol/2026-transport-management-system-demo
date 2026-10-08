import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { mapProvider } from './provider';

export type MarkerTone = 'blue' | 'red' | 'amber' | 'green' | 'slate' | 'purple';
export interface MapMarker { id: string | number; lat: number; lng: number; label?: string; tone?: MarkerTone; kind?: 'truck' | 'plant' | 'pin'; selected?: boolean; onClick?: () => void; tooltip?: string }
export interface MapRoute { id: string | number; path: [number, number][]; color?: string; dashed?: boolean; weight?: number }

const HEX: Record<MarkerTone, string> = { blue: '#2563eb', red: '#dc2626', amber: '#d97706', green: '#16a34a', slate: '#64748b', purple: '#7c3aed' };
const TRUCK = '<path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" fill="#fff"/><circle cx="7" cy="17" r="1.8" fill="#fff"/><circle cx="17" cy="17" r="1.8" fill="#fff"/>';
const PLANT = '<path d="M5 18V9l5 3V9l5 3V6h3v12z" fill="#fff"/>';

function icon(m: MapMarker) {
  const c = HEX[m.tone ?? 'blue']; const size = m.kind === 'pin' ? 22 : m.selected ? 42 : 34;
  const body = m.kind === 'plant' ? PLANT : m.kind === 'pin' ? '<circle cx="12" cy="12" r="4" fill="#fff"/>' : TRUCK;
  const ring = m.selected ? `box-shadow:0 0 0 4px ${c}44;` : '';
  return L.divIcon({
    className: 'truck-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${c};border:2px solid #fff;${ring}box-shadow:0 2px 6px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center"><svg width="${size * 0.62}" height="${size * 0.62}" viewBox="0 0 24 24">${body}</svg></div>`,
  });
}

function Fit({ points, trigger }: { points: [number, number][]; trigger: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], Math.max(map.getZoom(), 9));
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 11 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

export function MapView({ markers = [], routes = [], height = 420, fitKey, className, followId }: { markers?: MapMarker[]; routes?: MapRoute[]; height?: number | string; fitKey?: string; className?: string; followId?: string | number }) {
  const [tileErrors, setTileErrors] = useState(0);
  const pts = useMemo(() => [...routes.flatMap((r) => r.path), ...markers.map((m) => [m.lat, m.lng] as [number, number])], [routes, markers]);
  return (
    <div className={className} style={{ height, position: 'relative' }}>
      <MapContainer center={mapProvider.defaultCenter} zoom={mapProvider.defaultZoom} scrollWheelZoom style={{ height: '100%', width: '100%', borderRadius: 12, background: '#e8eef6' }} attributionControl>
        <TileLayer url={mapProvider.tileUrl} attribution={mapProvider.attribution} eventHandlers={{ tileerror: () => setTileErrors((n) => n + 1) }} />
        {routes.map((r) => <Polyline key={r.id} positions={r.path} pathOptions={{ color: r.color ?? '#2563eb', weight: r.weight ?? 4, opacity: 0.85, dashArray: r.dashed ? '8 8' : undefined }} />)}
        {markers.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={icon(m)} zIndexOffset={m.selected ? 1000 : 0} eventHandlers={{ click: () => m.onClick?.() }}>
            {(m.tooltip || m.label) && <Tooltip direction="top" offset={[0, -14]}>{m.tooltip ?? m.label}</Tooltip>}
          </Marker>
        ))}
        <Fit points={pts} trigger={fitKey ?? String(pts.length)} />
        {followId !== undefined && <Follow target={markers.find((m) => m.id === followId)} />}
      </MapContainer>
      {tileErrors > 4 && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] max-w-xs rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow">
          Map tiles could not be loaded (offline or blocked). Vehicle positions and routes are still accurate.
        </div>
      )}
    </div>
  );
}

function Follow({ target }: { target?: MapMarker }) {
  const map = useMap();
  useEffect(() => { if (target && !map.getBounds().pad(-0.15).contains([target.lat, target.lng])) map.panTo([target.lat, target.lng], { animate: true }); }, [target?.lat, target?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
