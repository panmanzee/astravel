// Real map for trips and places: Leaflet (self-hosted) + OpenStreetMap tiles.
// Place search / reverse lookup use OpenStreetMap Nominatim, one request at a time, only on user action.
import { h } from './core.js';

let lib;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return (lib ||= new Promise((res, rej) => {
    document.head.append(h('link', { rel: 'stylesheet', href: '/vendor/leaflet.css' }));
    const s = h('script', { src: '/vendor/leaflet.js' }); s.onload = () => res(window.L); s.onerror = () => rej(new Error('map library failed to load')); document.head.append(s);
  }));
}

const cache = new Map(); let chain = Promise.resolve(); let lastAt = 0;
function nominatim(path) {
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  const run = async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastAt)); if (wait) await new Promise((r) => setTimeout(r, wait)); lastAt = Date.now();
    const r = await fetch(`https://nominatim.openstreetmap.org/${path}&format=jsonv2&accept-language=en`);
    if (!r.ok) throw new Error('lookup failed'); const j = await r.json(); cache.set(path, j); return j;
  };
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}
export const findPlace = async (q) => { const r = await nominatim(`search?limit=1&q=${encodeURIComponent(q)}`); return r[0] ? { lat: +r[0].lat, lng: +r[0].lon, name: (r[0].name || r[0].display_name.split(',')[0]).slice(0, 60) } : null; };
export const nameAt = async (lat, lng) => { try { const r = await nominatim(`reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&zoom=17`); return (r.name || (r.display_name || '').split(',')[0] || 'Pinned place').slice(0, 60); } catch (_) { return 'Pinned place'; } };

// opts: { editable, onSelect(key), onMove(key,lat,lng), onAdd(lat,lng,name), pad() -> {l,r,t,b} }
export async function mountMap(el, opts = {}) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: opts.editable || !L.Browser.mobile, tap: true, worldCopyJump: true, minZoom: 2, maxZoom: 18 }).setView([36, 138], 5);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
  map.on('focus', () => map.scrollWheelZoom.enable()); map.on('blur', () => map.scrollWheelZoom.disable());
  const layer = L.layerGroup().addTo(map); const markers = new Map(); let sel = null; let pts = [];
  const pad = () => { const p = (opts.pad && opts.pad()) || {}; return { tl: [(p.l || 0) + 36, (p.t || 0) + 36], br: [(p.r || 0) + 36, (p.b || 0) + 36] }; };
  const icon = (n, on) => L.divIcon({ className: 'mk' + (on ? ' on' : ''), html: `<span><b>${n}</b></span>`, iconSize: [34, 42], iconAnchor: [17, 40] });
  const api = {
    map,
    fit() { if (!pts.length) return; const b = L.latLngBounds(pts); const p = pad(); if (pts.length === 1) map.setView(pts[0], 12, { animate: false }); else map.fitBounds(b, { paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: 13, animate: false });
      if (pts.length === 1) { const c = map.project(pts[0], 12); const pp = pad(); map.setView(map.unproject(c.subtract([(pp.tl[0] - pp.br[0]) / 2, (pp.tl[1] - pp.br[1]) / 2]), 12), 12, { animate: false }); } },
    set(stops, selectedKey) {
      layer.clearLayers(); markers.clear(); pts = []; let n = 0; let prev = null;
      stops.forEach((s) => {
        if (s.lat == null) return; n++; const ll = [s.lat, s.lng]; pts.push(ll);
        const m = L.marker(ll, { icon: icon(n, s.key === selectedKey), draggable: !!opts.editable, keyboard: true, title: s.name, riseOnHover: true }).addTo(layer);
        m.on('click', () => { sel = s.key; opts.onSelect && opts.onSelect(s.key); }); m.on('dragend', () => { const p = m.getLatLng(); opts.onMove && opts.onMove(s.key, p.lat, p.lng); });
        markers.set(s.key, { m, n }); if (prev && prev.day === s.day) L.polyline([prev.ll, ll], { color: '#60a5fa', weight: 3, dashArray: '2 8', lineCap: 'round', opacity: .9 }).addTo(layer);
        prev = { ll, day: s.day };
      });
      sel = selectedKey;
    },
    select(key, fly) { markers.forEach((v, k) => v.m.setIcon(icon(v.n, k === key))); sel = key; const v = markers.get(key); if (v && fly) map.panTo(v.m.getLatLng(), { animate: true }); },
    flyTo(lat, lng) { map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { duration: .8 }); },
    invalidate() { map.invalidateSize(); },
  };
  if (opts.editable && opts.onAdd) {
    map.on('click', async (e) => {
      const { lat, lng } = e.latlng; const box = h('div', { class: 'mp' }, h('b', {}, 'Looking up place…'));
      const pop = L.popup({ closeButton: false, offset: [0, -6], className: 'mpop' }).setLatLng(e.latlng).setContent(box).openOn(map);
      const name = await nameAt(lat, lng);
      box.replaceChildren(h('b', {}, name), h('button', { class: 'btn', type: 'button', onclick: () => { opts.onAdd(lat, lng, name); map.closePopup(); } }, '+ Add to trip'));
      pop.update();
    });
  }
  if (typeof ResizeObserver !== 'undefined') { let t; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { map.invalidateSize(); api.fit(); }, 80); }).observe(el); }
  return api;
}
