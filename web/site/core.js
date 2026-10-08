// core: DOM helper, icons, persistent store, router, toast. User text is only ever inserted as text nodes.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];


// DOM replaceChildren/append stringify null/false -> drop them so conditional children are safe
for (const m of ['replaceChildren', 'append', 'prepend']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...a) { return orig.apply(this, a.flat(Infinity).filter((x) => x != null && x !== false)); };
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const P = {
  heart: '<path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 6.1-8 11-8 11z"/>',
  share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4"/>',
  filter: '<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  pin: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
  dollar: '<path d="M12 3v18M16.5 7.5C15.8 6.2 14.2 5.5 12 5.5c-2.5 0-4 1.2-4 3s1.5 2.5 4 3 4 1.3 4 3.2-1.6 3.3-4 3.3c-2.3 0-4-.9-4.6-2.4"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  dash: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5"/><rect x="13.5" y="11" width="7" height="9.5" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c1-4.2 4-6 7.5-6s6.500 1.800 7.500 6"/>',
  report: '<path d="M5 20V10M11 20V4M17 20v-7M3 20h18"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5l1.5 2.700 3-.6.9 2.900 2.800 1.200-1 2.900 1 2.900-2.800 1.200-.9 2.900-3-.6L12 21.500l-1.500-2.700-3 .6-.9-2.900-2.800-1.200 1-2.900-1-2.900 2.800-1.200.9-2.900 3 .6z"/>',
  check: '<path d="M5 12.5l4.500 4.500L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  tri: '<path d="M12 6l7 12H5z"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico ' + cls); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}
export const heartFilled = (cls = '') => { const s = icon('heart', cls); s.style.fill = 'currentColor'; return s; };

export function toast(msg, kind) {
  const t = h('div', { class: 'toast' + (kind === 'err' ? ' err' : ''), role: kind === 'err' ? 'alert' : 'status' }, msg);
  document.body.append(t); setTimeout(() => t.remove(), kind === 'err' ? 4200 : 2600);
}

// ----- app state: loaded from the server (/api/bootstrap), never trusted from localStorage
import { api, ApiError } from './api.js';
export const state = { ready: false, me: null, catalog: [], trips: [], wishlist: [], following: [], followers: [], googleClientId: null, appName: 'ASTRAVEL', maint: false };
export const store = () => state;
export async function refresh() {
  const d = await api.get('/bootstrap');
  Object.assign(state, { me: null, trips: [], wishlist: [], following: [], followers: [] }, d, { ready: true });
  return state;
}
export const isStaff = () => !!(state.me && state.me.staff);
export const can = (module, action) => !!(state.me && (state.me.role === 'Super Admin' || (state.me.perms[module] || [])[{ view: 0, create: 1, edit: 2, delete: 3 }[action]]));

// Run an API call and show a friendly message on failure. Returns undefined when it fails.
export async function attempt(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r === undefined ? true : r; }
  catch (e) {
    if (e instanceof ApiError && e.status === 401 && state.me) { state.me = null; toast('Your session ended. Please sign in again.', 'err'); go('/login'); return; }
    toast(e.message || 'Something went wrong', 'err');
  }
}

// ----- router (History API; the web server falls back to index.html)
const routes = [];
export function route(pattern, handler, opts = {}) {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, handler, ...opts });
}
export function go(path, replace) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  return render();
}
let token = 0;
export async function render() {
  const my = ++token; const path = location.pathname; const root = $('#app');
  if (!state.ready) {
    root.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
    try { await refresh(); } catch (e) {
      root.replaceChildren(h('div', { class: 'loading', style: { flexDirection: 'column', gap: '16px', textAlign: 'center' } }, h('p', {}, 'We can’t reach the server right now.'),
        h('button', { class: 'btn', type: 'button', onclick: () => render() }, 'Try again'))); return;
    }
  }
  if (my !== token) return;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (r.auth && !state.me) { sessionStorage.setItem('next', path + location.search); return go('/login', true); }
    if (r.admin && !isStaff()) { if (!state.me) { sessionStorage.setItem('next', path); return go('/login', true); } toast('You don’t have access to the admin console', 'err'); return go('/', true); }
    if (state.maint && !isStaff() && path !== '/login') { const { maintenanceView } = await import('./views.js'); const v = maintenanceView(); root.replaceChildren(...v); document.title = v.title; return; }
    root.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
    try {
      const view = await r.handler(params);
      if (my !== token) return;
      if (!view) return;
      root.replaceChildren(...view); window.scrollTo(0, 0); if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); } document.title = (view.title ? view.title + ' · ' : '') + state.appName;
    } catch (err) {
      if (my !== token) return;
      console.error(err);
      if (err instanceof ApiError && err.status === 401) { state.me = null; sessionStorage.setItem('next', path); return go('/login', true); }
      root.replaceChildren(h('div', { class: 'loading', style: { flexDirection: 'column', gap: '16px', textAlign: 'center' } },
        h('p', {}, err instanceof ApiError ? err.message : 'Something went wrong while loading this page.'),
        h('button', { class: 'btn', type: 'button', onclick: () => render() }, 'Try again')));
    }
    return;
  }
  go('/', true);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || a.target) return;
  e.preventDefault(); go(a.getAttribute('href'));
});
addEventListener('popstate', render);
export const link = (href, props, ...kids) => h('a', { href, 'data-link': '', ...props }, ...kids);
