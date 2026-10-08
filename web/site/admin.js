// Admin console: every number, table and setting here comes from the server (PostgreSQL) and every action is checked there against the role's permissions.
import { h, icon, link, state, toast, attempt, can } from './core.js';
import { api } from './api.js';
import { page } from './views.js';
import { dialog, confirmBox } from './ui.js';

const NAV = [['/admin', 'Dashboard', 'dash', 'dash', null], ['/admin/users', 'Users', 'user', 'users', ['Users', 'view']], ['/admin/reports', 'Reports', 'report', 'reports', ['Reports', 'view']],
  ['/admin/roles', 'Roles & Permissions', 'key', 'roles', null], ['/admin/audit', 'Audit Log', 'doc', 'audit', ['Audit Log', 'view']], ['/admin/settings', 'Settings', 'gear', 'settings', null]];
const SVG = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c))); return e; };
const label = (k) => (NAV.find((n) => n[3] === k) || [])[1] || 'Admin';

let SET = { tz: 'UTC+0', datefmt: 'DD/MM/YYYY', name: 'ASTRAVEL Admin' };
async function loadSettings() { try { SET = { ...SET, ...(await api.get('/admin/settings')) }; } catch (_) { /* viewers still work with defaults */ } }
const pad = (n) => String(n).padStart(2, '0');
function dt(iso, time = true) {
  if (!iso) return '–';
  const m = /UTC([+-]\d+)/.exec(SET.tz || ''); const off = m ? +m[1] : 0; const d = new Date(new Date(iso).getTime() + off * 3600000);
  const Y = d.getUTCFullYear(), M = pad(d.getUTCMonth() + 1), D = pad(d.getUTCDate());
  const day = SET.datefmt === 'MM/DD/YYYY' ? `${M}/${D}/${Y}` : SET.datefmt === 'YYYY-MM-DD' ? `${Y}-${M}-${D}` : `${D}/${M}/${Y}`;
  return time ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : day;
}
const rel = (iso) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 90 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : s < 2592000 ? Math.floor(s / 86400) + 'd ago' : dt(iso, false); };
const dur = (s) => { const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m`; };

function shell(active, body, cls = '') {
  const links = NAV.filter(([, , , , need]) => !need || can(need[0], need[1]));
  const side = h('nav', { class: 'side', 'aria-label': 'Admin' }, ...links.map(([href, lab, ic, key]) => link(href, { class: key === active ? 'on' : '', 'aria-current': key === active ? 'page' : null }, icon(ic), lab)));
  return page('admin', label(active), h('div', { class: 'adm ' + cls }, side, h('div', { class: 'main' }, ...body)));
}
const errBox = (msg) => h('div', { class: 'card', style: { padding: '24px' } }, h('p', {}, msg));
const selectBox = (aria, opts, onchange, val) => h('select', { class: 'a-sel', 'aria-label': aria, onchange }, ...opts.map(([v, t]) => h('option', { value: v, selected: v === val ? '' : null }, t)));

function lineChart(points, { w = 640, hgt = 260, color = '#0f172a', fmt = (v) => v } = {}) {
  const L = 44, R = 16, T = 14, B = 28; const max = Math.max(1, ...points.map((p) => p.v)); const top = Math.ceil(max / 4) * 4 || 4;
  const x = (i) => L + (points.length < 2 ? (w - L - R) / 2 : (i * (w - L - R)) / (points.length - 1)); const y = (v) => T + (hgt - T - B) * (1 - v / top);
  const s = sv('svg', { viewBox: `0 0 ${w} ${hgt}`, width: '100%', role: 'img', 'aria-label': 'Line chart', preserveAspectRatio: 'xMidYMid meet', style: 'max-width:100%;height:auto' });
  [0, 1, 2, 3, 4].forEach((i) => { const v = (top * i) / 4; s.append(sv('line', { x1: L, x2: w - R, y1: y(v), y2: y(v), stroke: '#e5e7eb', 'stroke-dasharray': '3 3' }), sv('text', { x: L - 8, y: y(v) + 4, 'font-size': 11, fill: '#9ca3af', 'text-anchor': 'end' }, fmt(v))); });
  if (points.length) {
    s.append(sv('polyline', { points: points.map((p, i) => `${x(i)},${y(p.v)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    points.forEach((p, i) => { s.append(sv('circle', { cx: x(i), cy: y(p.v), r: 3.5, fill: '#fff', stroke: color, 'stroke-width': 2 }, sv('title', {}, `${p.t}: ${p.v}`))); if (points.length <= 12 || i % Math.ceil(points.length / 8) === 0) s.append(sv('text', { x: x(i), y: hgt - 8, 'font-size': 11, fill: '#9ca3af', 'text-anchor': 'middle' }, p.t)); });
  } else s.append(sv('text', { x: w / 2, y: hgt / 2, 'font-size': 13, fill: '#9ca3af', 'text-anchor': 'middle' }, 'No data in this period yet'));
  return s;
}
function barChart(points, { w = 560, hgt = 260 } = {}) {
  const L = 36, R = 8, T = 14, B = 28; const max = Math.max(1, ...points.map((p) => p.v)); const top = Math.ceil(max / 4) * 4 || 4; const bw = (w - L - R) / points.length;
  const s = sv('svg', { viewBox: `0 0 ${w} ${hgt}`, width: '100%', role: 'img', 'aria-label': 'Bar chart', style: 'max-width:100%;height:auto' });
  [0, 1, 2, 3, 4].forEach((i) => { const v = (top * i) / 4; const yy = T + (hgt - T - B) * (1 - v / top); s.append(sv('line', { x1: L, x2: w - R, y1: yy, y2: yy, stroke: '#e5e7eb', 'stroke-dasharray': '3 3' }), sv('text', { x: L - 6, y: yy + 4, 'font-size': 11, fill: '#9ca3af', 'text-anchor': 'end' }, Math.round(v))); });
  points.forEach((p, i) => { const bh = (hgt - T - B) * (p.v / top); s.append(sv('rect', { x: L + i * bw + 3, y: hgt - B - bh, width: Math.max(4, bw - 6), height: bh, fill: '#f3f4f6', stroke: '#1f2937' }, sv('title', {}, `${p.t}: ${p.v}`)), sv('text', { x: L + i * bw + bw / 2, y: hgt - 8, 'font-size': 10, fill: '#9ca3af', 'text-anchor': 'middle' }, p.t)); });
  return s;
}
const pager = (info, page, per, total, go) => {
  const pages = Math.max(1, Math.ceil(total / per)); const btn = (t, p, on, dis) => h('button', { type: 'button', class: on ? 'on' : '', disabled: dis, onclick: () => go(p) }, t);
  const nums = []; for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(btn(String(i), i, i === page));
  return h('div', { class: 'pager', style: { padding: '0' } }, info, h('div', { class: 'pg' }, btn('Previous', page - 1, false, page <= 1), ...nums, btn('Next', page + 1, false, page >= pages)));
};

// ───────────────────────── dashboard
export async function dashView() {
  await loadSettings();
  let d = await api.get('/admin/stats');
  const stat = (t, v, sub, up) => h('div', { class: 'card stat' }, h('h3', {}, t), h('b', {}, v), h('span', {}, up == null ? '' : h('i', {}, up ? '▲' : '▼'), sub));
  const stats = h('div', { class: 'stats' }); const chartBox = h('div', { class: 'live-chart' }); const alertsBox = h('div', { class: 'card alerts' }); const healthBox = h('div', { class: 'card health2' });
  const draw = () => {
    stats.replaceChildren(stat('Active Users', String(d.activeUsers), `${d.users} registered · ${d.newToday} new today`), stat('Requests (last hour)', d.requestsHour.toLocaleString(), 'API calls'),
      stat('Error Rate', d.errorRate + '%', 'server errors, last hour'), stat('Uptime', dur(d.uptimeSec), 'since the API last restarted'));
    chartBox.replaceChildren(lineChart(d.series.map((p) => ({ t: dt(p.t, true).slice(-5), v: p.n })), { fmt: (v) => Math.round(v) }));
    alertsBox.replaceChildren(h('h3', {}, 'Recent activity & alerts'), ...(d.alerts.length ? d.alerts.map((a) => h('div', { class: 'alert' }, h('i', { class: a.level }), h('b', {}, a.text), h('small', {}, rel(a.ts)))) : [h('p', { class: 'a-m' }, 'Nothing to report.')]));
    healthBox.replaceChildren(h('h3', {}, 'System Health & Services'), ...d.health.map((x) => h('div', { class: 'hrow2' }, h('span', { class: 'n' }, x.name), h('span', { class: 'b' + (x.ok ? '' : ' bad') }, x.ok ? 'Healthy' : 'Down'), h('span', { class: 'a-m' }, x.detail))),
      h('div', { class: 'hrow2' }, h('span', { class: 'n' }, 'Content'), h('span', { class: 'b' }, 'In database'), h('span', { class: 'a-m' }, `${d.trips} trips · ${d.reviews} reviews`)));
  };
  draw();
  const timer = setInterval(async () => { if (!document.body.contains(stats)) return clearInterval(timer); try { d = await api.get('/admin/stats'); draw(); } catch (_) { /* keep last values */ } }, 15000);
  return shell('dash', [stats, h('div', { class: 'row2' }, h('div', { class: 'card chart' }, h('h3', {}, 'Requests per 10 minutes'), h('div', { class: 'live' }, 'Updates every 15 s'), chartBox), alertsBox), healthBox], 'dash');
}

// ───────────────────────── users
export async function usersView() {
  await loadSettings();
  const roles = (await api.get('/admin/roles')).roles.map((r) => r.name);
  const f = { role: '', status: '', q: '', page: 1 }; const per = 10;
  const body = h('tbody'); const info = h('span', {}); const search = h('input', { placeholder: 'Search name or email', 'aria-label': 'Search users', maxlength: '80' });
  const role = selectBox('Role', [['', 'Role: All'], ...roles.map((r) => [r, r])], (e) => { f.role = e.target.value; f.page = 1; load(); }, '');
  const status = selectBox('Status', [['', 'Status: All'], ['Active', 'Active'], ['Inactive', 'Inactive']], (e) => { f.status = e.target.value; f.page = 1; load(); }, '');
  const wrapT = h('div', { class: 'card tcard', style: { padding: '20px 20px 0' } });
  async function load() {
    let r; try { r = await api.get(`/admin/users?role=${encodeURIComponent(f.role)}&status=${f.status}&q=${encodeURIComponent(f.q)}&page=${f.page}&per=${per}`); } catch (e) { toast(e.message, 'err'); return; }
    body.replaceChildren(...(r.users.length ? r.users.map((u) => h('tr', {},
      h('td', { class: 's' }, u.name), h('td', {}, u.email), h('td', {}, u.role), h('td', {}, h('span', { class: 'badge-s' }, u.status)), h('td', { title: `Joined ${dt(u.joined)}` }, rel(u.lastActive)),
      h('td', {}, can('Users', 'edit') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Edit ${u.name}`, onclick: () => edit(u) }, icon('pencil')) : null,
        can('Users', 'delete') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${u.name}`, onclick: () => del(u) }, icon('trash')) : null)))
      : [h('tr', {}, h('td', { colspan: 6, style: { padding: '28px', textAlign: 'center', color: '#6b7280' } }, 'No users match these filters.'))]));
    wrapT.replaceChildren(h('div', { class: 'tscroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...['Name', 'Email', 'Role', 'Status', 'Last Active', 'Actions'].map((t) => h('th', {}, t)))), body)),
      pager(h('span', {}, `Showing ${r.users.length} of ${r.total} user${r.total === 1 ? '' : 's'}`), r.page, r.per, r.total, (p) => { f.page = p; load(); }));
  }
  async function edit(u) {
    const r = await dialog({ title: `Edit ${u.name}`, body: u.email, ok: 'Save', fields: [{ name: 'role', label: 'Role', type: 'select', value: u.role, options: roles }, { name: 'status', label: 'Status', type: 'select', value: u.status, options: ['Active', 'Inactive'] }] });
    if (r && (r.role !== u.role || r.status !== u.status) && await attempt(() => api.patch(`/admin/users/${u.id}`, { role: r.role, status: r.status }), 'User updated')) load();
  }
  async function del(u) { if (await confirmBox(`Delete ${u.name}?`, 'Their account, trips, reviews and follows are permanently removed.', 'Delete user') && await attempt(() => api.del(`/admin/users/${u.id}`), 'User deleted')) load(); }
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = search.value.trim(); f.page = 1; load(); }, 250); });
  await load();
  return shell('users', [h('div', { class: 'fbar' }, role, status, h('span', { class: 'grow' }), h('label', { class: 'a-search' }, search, icon('search'))), wrapT], '');
}

// ───────────────────────── reports
export async function reportsView() {
  await loadSettings();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = new Date(); let to = iso(today); let from = iso(new Date(today.getTime() - 29 * 86400000));
  const wrap = h('div'); const fromIn = h('input', { type: 'date', class: 'a-in dt', 'aria-label': 'From date', value: from, max: to }); const toIn = h('input', { type: 'date', class: 'a-in dt', 'aria-label': 'To date', value: to });
  const seg = h('div', { class: 'seg' }); let active = '30d';
  const presets = { '7d': 6, '30d': 29, '90d': 89, '1y': 364 };
  const drawSeg = () => seg.replaceChildren(...Object.keys(presets).map((k) => h('button', { type: 'button', class: k === active ? 'on' : '', onclick: () => { active = k; to = iso(new Date()); from = iso(new Date(Date.now() - presets[k] * 86400000)); fromIn.value = from; toIn.value = to; drawSeg(); load(); } }, k)));
  drawSeg();
  const onDate = () => { if (fromIn.value && toIn.value && fromIn.value <= toIn.value) { from = fromIn.value; to = toIn.value; active = ''; drawSeg(); load(); } else toast('The start date must be before the end date', 'err'); };
  fromIn.addEventListener('change', onDate); toIn.addEventListener('change', onDate);
  const kpi = (t, v, s) => h('div', { class: 'card kpi' }, h('h4', {}, t), h('b', {}, String(v)), h('span', {}, s));
  async function load() {
    let r; try { r = await api.get(`/admin/reports?from=${from}&to=${to}`); } catch (e) { wrap.replaceChildren(errBox(e.message)); return; }
    const days = Math.max(1, Math.round((new Date(r.to) - new Date(r.from)) / 86400000) + 1);
    const exp = (what, name, desc) => h('tr', {}, h('td', { style: { color: '#111827', fontWeight: 500, height: '50px' } }, name), h('td', {}, desc), h('td', { class: 'r' }, h('a', { class: 'a-btn', href: `/api/admin/export/${what}?from=${r.from}&to=${r.to}`, download: '', 'aria-label': `Download ${name} CSV` }, icon('down'), ' CSV')));
    wrap.replaceChildren(
      h('div', { class: 'charts' }, h('div', { class: 'card ch2' }, h('h3', {}, 'User Growth (new accounts per month, last 12 months)'), barChart(r.growth.map((g) => ({ t: g.m.slice(5), v: g.n })))),
        h('div', { class: 'card ch2' }, h('h3', {}, 'Request Volume (per day)'), lineChart(r.requests.map((x) => ({ t: x.d.slice(5), v: x.n })), { w: 560 }))),
      h('div', { class: 'kpis' }, kpi('New Users', r.kpi.new_users, `${(r.kpi.new_users / days).toFixed(1)} per day on average`), kpi('Trips Created', r.kpi.trips, `${r.totals.trips} trips in total`), kpi('Reviews Posted', r.kpi.reviews, `${r.totals.reviews} reviews in total`), kpi('Peak Load', `${r.peakPerMin} req/min`, 'busiest 10-minute window in range')),
      h('div', { class: 'card rcr' }, h('h3', {}, 'Export data (CSV, for the selected dates)'),
        h('div', { class: 'tscroll' }, h('table', { class: 'tbl p12', style: { marginTop: '4px' } }, h('thead', {}, h('tr', {}, h('th', {}, 'Report'), h('th', {}, 'What it contains'), h('th', { class: 'r' }, 'Download'))),
          h('tbody', {}, exp('users', 'Users', 'Accounts created in the range: name, email, role, status'), exp('trips', 'Trips', 'Trips created in the range: owner, public flag, number of days'), can('Audit Log', 'view') ? exp('audit', 'Audit log', 'Every logged action in the range') : null)))));
  }
  await load();
  return shell('reports', [h('div', { class: 'card range', style: { marginTop: '0' } }, h('label', { class: 'date' }, icon('cal'), 'From: ', fromIn), h('label', { class: 'date' }, icon('cal'), 'To: ', toIn), h('span', { class: 'sep' }), seg), wrap], '');
}

// ───────────────────────── roles
export async function rolesView() {
  await loadSettings();
  const data = await api.get('/admin/roles'); const mods = data.modules; const all = data.roles;
  let cur = (all.find((r) => r.name === state.me.role) || all[0]).name; let draft;
  const wrap = h('div', { class: 'roles' });
  const roleOf = (n) => all.find((r) => r.name === n);
  const reset = () => { draft = JSON.parse(JSON.stringify(roleOf(cur).perms)); };
  reset();
  function draw() {
    const r = roleOf(cur); const locked = r.name === 'Super Admin' || !r.staff || !can('Users', 'edit') || (r.name === state.me.role && state.me.role !== 'Super Admin');
    const why = r.name === 'Super Admin' ? 'The Super Admin role always has every permission.' : !r.staff ? 'Members never get access to the admin console.' : !can('Users', 'edit') ? 'Your role can view permissions but not change them.' : r.name === state.me.role ? 'You can’t change the permissions of your own role.' : '';
    wrap.replaceChildren(
      h('div', { class: 'rlist' }, h('h3', {}, 'Available Roles'), ...all.map((x) => h('button', { class: 'rl' + (x.name === cur ? ' on' : ''), type: 'button', onclick: () => { cur = x.name; reset(); draw(); } },
        h('b', {}, x.name), x.name === cur ? h('span', { class: 'badge-s sel' }, 'Selected') : null, h('span', {}, `${x.members} member${x.members === 1 ? '' : 's'}${x.staff ? '' : ' (no admin access)'}`)))),
      h('div', { class: 'card perm' }, h('h3', {}, `${cur} Permissions`), h('p', { class: 'a-m', style: { margin: '2px 0 0' } }, why || `Choose what members assigned to the ${cur} role can do. Changes apply immediately after saving.`),
        h('div', { class: 'tscroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...['Module', 'View', 'Create', 'Edit', 'Delete'].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...mods.map((m, i) => h('tr', {}, h('td', {}, m), ...[0, 1, 2, 3].map((c) => h('td', {}, h('input', { type: 'checkbox', class: 'ck', checked: r.name === 'Super Admin' ? true : !!draft[i][c], disabled: locked, 'aria-label': `${cur} ${['view', 'create', 'edit', 'delete'][c]} ${m}`, onchange: (e) => { draft[i][c] = e.target.checked ? 1 : 0; } })))))))),
        locked ? null : h('div', { class: 'pbtns' }, h('button', { class: 'a-btn', type: 'button', onclick: () => { reset(); draw(); toast('Changes discarded'); } }, 'Discard Changes'),
          h('button', { class: 'a-btn dark', type: 'button', onclick: async () => { if (await attempt(() => api.put(`/admin/roles/${encodeURIComponent(cur)}`, { perms: draft }), `${cur} permissions saved`)) { r.perms = JSON.parse(JSON.stringify(draft)); } } }, 'Save Changes'))));
  }
  draw();
  return shell('roles', [wrap], '');
}

// ───────────────────────── audit
export async function auditView() {
  await loadSettings();
  const f = { user: '', action: '', q: '', page: 1 }; const per = 10;
  const body = h('tbody'); const wrapT = h('div', { class: 'card tcard t2', style: { padding: '20px 20px 0' } });
  const search = h('input', { placeholder: 'Search actions, targets...', 'aria-label': 'Search the audit log', maxlength: '80' });
  const bar = h('div', { class: 'fbar' });
  let first = true;
  async function load() {
    let r; try { r = await api.get(`/admin/audit?user=${encodeURIComponent(f.user)}&action=${encodeURIComponent(f.action)}&q=${encodeURIComponent(f.q)}&page=${f.page}&per=${per}`); } catch (e) { toast(e.message, 'err'); return; }
    if (first) { first = false; bar.replaceChildren(selectBox('User', [['', 'User: All'], ...r.actors.map((a) => [a, a])], (e) => { f.user = e.target.value; f.page = 1; load(); }, ''), selectBox('Action type', [['', 'Action Type: All'], ...r.actions.map((a) => [a, a])], (e) => { f.action = e.target.value; f.page = 1; load(); }, ''), h('span', { class: 'grow' }), h('label', { class: 'a-search sm' }, icon('search'), search)); }
    body.replaceChildren(...(r.rows.length ? r.rows.map((x) => h('tr', {}, h('td', {}, dt(x.ts)), h('td', { class: 's', style: { wordBreak: 'break-all' } }, x.actor), h('td', {}, x.action), h('td', {}, x.target), h('td', { style: { color: '#9ca3af' } }, x.ip || '–'), h('td', { class: 'r', style: { paddingRight: '16px' } }, h('span', { class: 'badge-s' }, x.status))))
      : [h('tr', {}, h('td', { colspan: 6, style: { padding: '28px', textAlign: 'center', color: '#6b7280' } }, 'No log entries match.'))]));
    wrapT.replaceChildren(h('div', { class: 'tscroll' }, h('table', { class: 'tbl p16' }, h('thead', {}, h('tr', {}, ...['Timestamp', 'User', 'Action', 'Target', 'IP Address'].map((t) => h('th', {}, t)), h('th', { class: 'r' }, 'Status'))), body)),
      pager(h('span', {}, `Showing ${r.rows.length} of ${r.total} log entries`), r.page, r.per, r.total, (p) => { f.page = p; load(); }));
  }
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = search.value.trim(); f.page = 1; load(); }, 250); });
  await load();
  return shell('audit', [bar, wrapT], '');
}

// ───────────────────────── settings
export async function settingsView() {
  await loadSettings();
  const S = { ...SET }; const wrap = h('div', { class: 'setg' }); const mayEdit = can('Settings', 'edit');
  const name = h('input', { class: 'a-in', value: S.name, id: 'an', maxlength: '40', 'aria-label': 'Application name', disabled: !mayEdit });
  const sel = (id, opts, v) => h('select', { class: 'a-sel', id, disabled: !mayEdit }, ...opts.map((o) => h('option', { selected: o === v ? '' : null }, o)));
  const lang = sel('lang', ['English', 'Thai', 'Japanese'], S.lang); const tz = sel('tz', ['UTC-5', 'UTC+0', 'UTC+7', 'UTC+9'], S.tz);
  const tog = h('button', { class: 'toggle', role: 'switch', type: 'button', 'aria-checked': String(!!S.maint), 'aria-label': 'Maintenance mode', style: { top: '0' }, disabled: !mayEdit, onclick: () => { S.maint = !S.maint; tog.setAttribute('aria-checked', String(S.maint)); } });
  wrap.append(h('div', { class: 'stabs', role: 'tablist' }, h('button', { role: 'tab', type: 'button', class: 'on', 'aria-selected': 'true' }, 'General')),
    h('div', { class: 'card sform' }, h('h3', {}, 'General Settings'), h('p', { class: 'a-m', style: { margin: '2px 0 0' } }, mayEdit ? 'Configure the portal name, how dates are shown in the admin console, and the service status.' : 'Your role can view settings but not change them.'),
      h('label', { class: 'l', for: 'an' }, 'Application Name'), name,
      h('div', { class: 'two' }, h('div', {}, h('label', { class: 'l', for: 'lang' }, 'Default Language'), lang), h('div', {}, h('label', { class: 'l', for: 'tz' }, 'Timezone (for dates in this console)'), tz)),
      h('div', { class: 'l', style: { fontWeight: 600, fontSize: '14px', margin: '24px 0 4px' } }, 'Date Format'),
      ...['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((fm) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'df', checked: S.datefmt === fm, disabled: !mayEdit, onchange: () => { S.datefmt = fm; } }), fm)),
      h('div', { style: { position: 'relative', height: '44px', marginTop: '22px' } }, h('div', { style: { font: '600 14px/20px var(--adm)' } }, 'Maintenance Mode'), h('div', { class: 'a-m', style: { fontSize: '12px', marginTop: '2px' } }, 'When on, only staff can use the site. Everyone else sees a maintenance page.'), tog),
      mayEdit ? h('div', { class: 'sfoot' }, h('button', { class: 'a-btn dark', type: 'button', onclick: async () => {
        const body = { name: name.value.trim() || 'ASTRAVEL Admin', lang: lang.value, tz: tz.value, datefmt: S.datefmt, maint: !!S.maint };
        if (body.maint && !(await confirmBox('Turn maintenance mode on?', 'Everyone except staff will be blocked until you turn it off.', 'Turn on'))) return;
        if (await attempt(() => api.put('/admin/settings', body), 'Settings saved')) { SET = { ...SET, ...body }; state.appName = body.name; state.maint = body.maint; }
      } }, 'Save Settings')) : null));
  return shell('settings', [wrap], '');
}
