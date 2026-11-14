import { useEffect } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import type { LocationAnalysis } from '../../shared/types';
import { SERIES_COLORS } from '../app.constant';

function FitLocations({ locations }: { locations: LocationAnalysis[] }) {
  const map = useMap();
  useEffect(() => {
    const unique = locations.filter((item, index) => locations.findIndex(other => other.location.id === item.location.id) === index);
    if (unique.length === 1) map.setView([unique[0].location.latitude, unique[0].location.longitude], 7);
    else if (unique.length > 1) map.fitBounds(latLngBounds(unique.map(item => [item.location.latitude, item.location.longitude])), { padding: [40, 40], maxZoom: 8 });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [locations, map]);
  return null;
}

export function LocationMap({ locations }: { locations: LocationAnalysis[] }) {
  const apiKey = import.meta.env.VITE_CARTO_BASEMAP_API_KEY;
  const tileUrl = `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png${apiKey ? `?key=${apiKey}` : ''}`;
  return <MapContainer center={[16.1, -86.5]} zoom={4} scrollWheelZoom={false} className="location-map" aria-label="Map of analyzed locations"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' url={tileUrl} /><FitLocations locations={locations} />{locations.map((item, index) => <CircleMarker key={`${item.location.id}-${index}`} center={[item.location.latitude, item.location.longitude]} radius={8} pathOptions={{ color: '#fffef9', weight: 3, fillColor: SERIES_COLORS[index % 2], fillOpacity: 1 }}><Popup><strong>{item.location.name}</strong><br />{item.location.latitude.toFixed(4)}°, {item.location.longitude.toFixed(4)}°<br />{item.period.startYear}–{item.period.endYear}</Popup></CircleMarker>)}</MapContainer>;
}
