// Where a device thinks it is: your real (approximate) location, a simulated city with optional movement,
// or any spot you pick on the map.
'use strict';
const { fetchJson } = require('./download');

const CITIES = [
  { id: 'houston', name: 'Houston', country: 'US', lat: 29.7604, lng: -95.3698 },
  { id: 'new-york', name: 'New York', country: 'US', lat: 40.7128, lng: -74.006 },
  { id: 'los-angeles', name: 'Los Angeles', country: 'US', lat: 34.0522, lng: -118.2437 },
  { id: 'chicago', name: 'Chicago', country: 'US', lat: 41.8781, lng: -87.6298 },
  { id: 'miami', name: 'Miami', country: 'US', lat: 25.7617, lng: -80.1918 },
  { id: 'toronto', name: 'Toronto', country: 'CA', lat: 43.6532, lng: -79.3832 },
  { id: 'mexico-city', name: 'Mexico City', country: 'MX', lat: 19.4326, lng: -99.1332 },
  { id: 'sao-paulo', name: 'São Paulo', country: 'BR', lat: -23.5505, lng: -46.6333 },
  { id: 'london', name: 'London', country: 'GB', lat: 51.5072, lng: -0.1276 },
  { id: 'paris', name: 'Paris', country: 'FR', lat: 48.8566, lng: 2.3522 },
  { id: 'madrid', name: 'Madrid', country: 'ES', lat: 40.4168, lng: -3.7038 },
  { id: 'berlin', name: 'Berlin', country: 'DE', lat: 52.52, lng: 13.405 },
  { id: 'dubai', name: 'Dubai', country: 'AE', lat: 25.2048, lng: 55.2708 },
  { id: 'lahore', name: 'Lahore', country: 'PK', lat: 31.5204, lng: 74.3587 },
  { id: 'mumbai', name: 'Mumbai', country: 'IN', lat: 19.076, lng: 72.8777 },
  { id: 'singapore', name: 'Singapore', country: 'SG', lat: 1.3521, lng: 103.8198 },
  { id: 'tokyo', name: 'Tokyo', country: 'JP', lat: 35.6762, lng: 139.6503 },
  { id: 'seoul', name: 'Seoul', country: 'KR', lat: 37.5665, lng: 126.978 },
  { id: 'sydney', name: 'Sydney', country: 'AU', lat: -33.8688, lng: 151.2093 },
  { id: 'lagos', name: 'Lagos', country: 'NG', lat: 6.5244, lng: 3.3792 },
];

// Approximate location from your internet connection (city level). Two providers in case one is down.
async function approximate() {
  try {
    const j = await fetchJson('https://ipwho.is/', { timeout: 8000 });
    if (j && j.success !== false && Number.isFinite(j.latitude)) return { lat: j.latitude, lng: j.longitude, label: [j.city, j.region, j.country_code].filter(Boolean).join(', ') };
  } catch {}
  const j = await fetchJson('https://ipapi.co/json/', { timeout: 8000 });
  if (!Number.isFinite(j.latitude)) throw new Error('Could not work out your location');
  return { lat: j.latitude, lng: j.longitude, label: [j.city, j.region, j.country_code || j.country].filter(Boolean).join(', ') };
}

// Place search for the map (OpenStreetMap Nominatim; light use, one request per search).
async function search(q) {
  const j = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { timeout: 10000 });
  return (j || []).map((r) => ({ lat: +r.lat, lng: +r.lon, label: r.display_name }));
}

// Movement for simulated locations: a slow loop around the chosen point.
// Returns a function t(seconds) -> { lat, lng, speed, bearing }.
function mover(center, motion) {
  if (motion === 'still' || !motion) return () => ({ lat: center.lat, lng: center.lng, speed: 0, bearing: 0 });
  const speed = motion === 'drive' ? 13 : 1.4;                       // m/s
  const radius = motion === 'drive' ? 1800 : 250;                    // metres
  const circ = 2 * Math.PI * radius;
  const mPerDegLat = 111320, mPerDegLng = 111320 * Math.cos((center.lat * Math.PI) / 180);
  return (t) => {
    const a = ((t * speed) / circ) * 2 * Math.PI;
    const wobble = 1 + 0.08 * Math.sin(a * 5);
    const dx = Math.cos(a) * radius * wobble, dy = Math.sin(a) * radius * wobble;
    const bearing = ((Math.atan2(Math.cos(a), -Math.sin(a)) * 180) / Math.PI + 360) % 360;
    return { lat: center.lat + dy / mPerDegLat, lng: center.lng + dx / mPerDegLng, speed, bearing };
  };
}

module.exports = { CITIES, approximate, search, mover };
