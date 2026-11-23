// Mural — where the sun is, and what part of the day that makes it. Pure maths, no I/O: used by the wallpaper runtime
// (dynamic skies, layers that only show at night…), the Studio's time scrubber and the tests.
const RAD = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Sun altitude and azimuth (degrees) for a moment and place. Good to a fraction of a degree, which is plenty here. */
export function sunPosition(date, lat, lon) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = ((357.529 + 0.98560028 * d) % 360) * RAD;
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  let H = (gmst * 15 + lon - ra) % 360; if (H > 180) H -= 360; if (H < -180) H += 360;
  const h = H * RAD, phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h)) / RAD;
  const az = (Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / RAD + 180 + 360) % 360;
  return { altitude: alt, azimuth: az, hourAngle: H, morning: H < 0 };
}

/** Blend weights for the four parts of the day (they add up to 1) from the sun's altitude. */
export function phasesFor(altitude, morning) {
  const day = smooth(-1, 10, altitude);
  const night = 1 - smooth(-14, -5, altitude);
  const tw = clamp(1 - day - night);
  const sum = day + night + tw || 1;
  return { night: night / sum, dawn: morning ? tw / sum : 0, day: day / sum, dusk: morning ? 0 : tw / sum };
}

/** A rough place from the time zone when the user hasn't picked one (longitude from the UTC offset). */
export function guessLocation(date = new Date()) {
  const off = -date.getTimezoneOffset() / 60; // hours east of UTC
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset(), jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const dst = date.getTimezoneOffset() < Math.max(jan, jul) ? 1 : 0; // summer time moves the clock, not the sun
  return { lat: off < -2 && off > -11 ? 34 : 40, lon: (off - dst) * 15, guessed: true };
}

/**
 * The sky for a moment: { altitude, azimuth, morning, phases, daylight (0..1), dayFrac (0..1 through the solar day) }.
 * hour (0..24, optional) pins the clock time for the Studio's scrubber; the date stays today.
 */
export function skyAt(date, loc, hour = null) {
  const place = loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) ? loc : guessLocation(date);
  let t = date;
  if (hour != null && Number.isFinite(hour)) { t = new Date(date); t.setHours(0, 0, 0, 0); t = new Date(t.getTime() + hour * 3600000); }
  const p = sunPosition(t, place.lat, place.lon);
  return { ...p, phases: phasesFor(p.altitude, p.morning), daylight: smooth(-12, 15, p.altitude), dayFrac: ((p.hourAngle + 180) / 360) };
}

/** Weighted value for a layer's "when" (e.g. {night:1, dusk:0.5}); missing keys count as 1 so "when" can be partial. */
export function whenWeight(when, phases) {
  if (!when) return 1;
  let v = 0;
  for (const k of ['night', 'dawn', 'day', 'dusk']) v += phases[k] * (when[k] == null ? 1 : when[k]);
  return clamp(v);
}

export const CITIES = [
  ['Houston', 29.76, -95.37], ['Dallas', 32.78, -96.8], ['Austin', 30.27, -97.74], ['San Antonio', 29.42, -98.49], ['New York', 40.71, -74.01],
  ['Los Angeles', 34.05, -118.24], ['Chicago', 41.88, -87.63], ['Miami', 25.76, -80.19], ['Atlanta', 33.75, -84.39], ['Denver', 39.74, -104.99],
  ['Seattle', 47.61, -122.33], ['San Francisco', 37.77, -122.42], ['Phoenix', 33.45, -112.07], ['Boston', 42.36, -71.06], ['Washington DC', 38.9, -77.04],
  ['Philadelphia', 39.95, -75.17], ['State College', 40.79, -77.86], ['Toronto', 43.65, -79.38], ['Vancouver', 49.28, -123.12], ['Mexico City', 19.43, -99.13],
  ['London', 51.51, -0.13], ['Manchester', 53.48, -2.24], ['Paris', 48.86, 2.35], ['Madrid', 40.42, -3.7], ['Barcelona', 41.39, 2.17],
  ['Lisbon', 38.72, -9.14], ['Rome', 41.9, 12.5], ['Milan', 45.46, 9.19], ['Berlin', 52.52, 13.4], ['Munich', 48.14, 11.58],
  ['Amsterdam', 52.37, 4.9], ['Istanbul', 41.01, 28.98], ['Cairo', 30.04, 31.24], ['Dubai', 25.2, 55.27], ['Abu Dhabi', 24.45, 54.38],
  ['Doha', 25.29, 51.53], ['Riyadh', 24.71, 46.68], ['Jeddah', 21.49, 39.19], ['Karachi', 24.86, 67.0], ['Lahore', 31.55, 74.34],
  ['Islamabad', 33.68, 73.05], ['Delhi', 28.61, 77.21], ['Mumbai', 19.08, 72.88], ['Singapore', 1.35, 103.82], ['Kuala Lumpur', 3.14, 101.69],
  ['Jakarta', -6.2, 106.85], ['Hong Kong', 22.32, 114.17], ['Shanghai', 31.23, 121.47], ['Beijing', 39.9, 116.41], ['Seoul', 37.57, 126.98],
  ['Tokyo', 35.68, 139.69], ['Sydney', -33.87, 151.21], ['Melbourne', -37.81, 144.96], ['Auckland', -36.85, 174.76], ['Johannesburg', -26.2, 28.05],
  ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82], ['São Paulo', -23.55, -46.63], ['Rio de Janeiro', -22.91, -43.17], ['Buenos Aires', -34.6, -58.38],
  ['Bogotá', 4.71, -74.07], ['Lima', -12.05, -77.04], ['Reykjavík', 64.15, -21.94], ['Oslo', 59.91, 10.75], ['Stockholm', 59.33, 18.07]
].map(([name, lat, lon]) => ({ name, lat, lon }));
