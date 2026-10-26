// Atoll — the glance: weather from Open-Meteo (free, no key; you pick the city) and CPU / memory use.
// Battery comes from the window itself (navigator.getBattery).
'use strict';
const os = require('os');
const { EventEmitter } = require('events');
const { run } = require('../platform/run');

// WMO weather codes -> label and the icon the island draws
const WMO = {
  0: ['Clear', 'sun'], 1: ['Mostly clear', 'sun'], 2: ['Partly cloudy', 'partly'], 3: ['Cloudy', 'cloud'], 45: ['Fog', 'fog'], 48: ['Fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'], 56: ['Freezing drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'], 66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'], 80: ['Showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'], 95: ['Thunderstorms', 'storm'], 96: ['Thunderstorms', 'storm'], 99: ['Thunderstorms', 'storm']
};
const describe = (code, isDay = 1) => { const [label, icon] = WMO[code] || ['—', 'cloud']; return { label, icon: !isDay && (icon === 'sun' || icon === 'partly') ? (icon === 'sun' ? 'moon' : 'partlyNight') : icon }; };

const useF = (units) => (units === 'f' ? true : units === 'c' ? false : /^(en-US|en-LR|my-MM)$|US$/.test(Intl.DateTimeFormat().resolvedOptions().locale || 'en-US'));

function weatherUrl(place, units) {
  const q = new URLSearchParams({ latitude: place.lat, longitude: place.lon, current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m', daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset', hourly: 'temperature_2m,weather_code,is_day', forecast_days: '2', timezone: 'auto' });
  if (useF(units)) { q.set('temperature_unit', 'fahrenheit'); q.set('wind_speed_unit', 'mph'); }
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

function shapeWeather(j, place, units) {
  const c = j.current || {}, d = j.daily || {}, h = j.hourly || {};
  const nowIso = c.time || '';
  const start = Math.max(0, (h.time || []).findIndex((t) => t >= nowIso.slice(0, 13)));
  return {
    place: place.name, f: useF(units),
    temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m),
    ...describe(c.weather_code, c.is_day),
    hi: Math.round(d.temperature_2m_max?.[0]), lo: Math.round(d.temperature_2m_min?.[0]), rain: d.precipitation_probability_max?.[0] ?? null,
    sunrise: d.sunrise?.[0] || null, sunset: d.sunset?.[0] || null,
    hours: (h.time || []).slice(start + 1, start + 7).map((t, i) => ({ t, temp: Math.round(h.temperature_2m[start + 1 + i]), ...describe(h.weather_code[start + 1 + i], h.is_day[start + 1 + i]) })),
    at: Date.now()
  };
}

class Glance extends EventEmitter {
  constructor({ getJson, place = () => null, units = () => 'auto' }) {
    super(); this.getJson = getJson; this.place = place; this.units = units;
    this.weather = null; this.werr = null; this.wtimer = null; this.sys = null; this.prevCpu = null; this.stimer = null;
  }
  start() { this.loadWeather(); }
  stop() { clearTimeout(this.wtimer); clearInterval(this.stimer); }
  async loadWeather() {
    clearTimeout(this.wtimer);
    const p = this.place();
    if (!p) { this.weather = null; this.emit('change'); return; }
    try { this.weather = shapeWeather(await this.getJson(weatherUrl(p, this.units())), p, this.units()); this.werr = null; }
    catch (e) { this.werr = String(e.message || e); }
    this.emit('change');
    this.wtimer = setTimeout(() => this.loadWeather(), 20 * 60e3);
  }
  async searchPlaces(q) {
    if (String(q || '').trim().length < 2) return [];
    const j = await this.getJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' })}`);
    return (j.results || []).map((r) => ({ name: r.name, admin: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude }));
  }
  /** Sample CPU and memory every 2 s while the island is open. */
  live(on) {
    clearInterval(this.stimer);
    if (!on) return;
    this.sample(); this.stimer = setInterval(() => this.sample(), 2000);
  }
  async sample() {
    const cpus = os.cpus(); let idle = 0, total = 0;
    for (const c of cpus) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
    let cpu = null;
    if (this.prevCpu) { const dt = total - this.prevCpu.total, di = idle - this.prevCpu.idle; cpu = dt > 0 ? Math.round(100 * (1 - di / dt)) : null; }
    this.prevCpu = { idle, total };
    const mem = await memory();
    this.sys = { cpu, mem, cores: cpus.length, at: Date.now() };
    this.emit('sys');
  }
  snapshot() { return { weather: this.weather, weatherError: this.werr, sys: this.sys }; }
}

/** Memory in use, %. On a Mac free memory looks tiny because macOS keeps file cache; vm_stat separates it out. */
async function memory() {
  const total = os.totalmem();
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/vm_stat', [], { timeout: 3000 });
    if (r.ok) {
      const page = Number((r.stdout.match(/page size of (\d+)/) || [])[1]) || 16384;
      const get = (k) => Number((r.stdout.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1]) || 0;
      const used = (get('Pages active') + get('Pages wired down') + get('Pages occupied by compressor')) * page;
      if (used > 0) return { used, total, pct: Math.round((100 * used) / total) };
    }
  }
  const used = total - os.freemem();
  return { used, total, pct: Math.round((100 * used) / total) };
}

module.exports = { Glance, describe, shapeWeather, weatherUrl, useF };
