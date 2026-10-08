// Small shared helpers for the page modules.
import { h, icon, toast } from './core.js';

export const q = () => new URLSearchParams(location.search);
export const eImg = (x, cls = '', alt = '') => h('img', { src: `/img/x${x}.webp`, alt, class: cls, loading: 'lazy', decoding: 'async' });
export const circleBtn = (ic, label, onclick, cls = 'circle-btn') => h('button', { class: cls, type: 'button', 'aria-label': label, title: label, onclick }, icon(ic));
export const copyLink = async (path) => { try { await navigator.clipboard.writeText(location.origin + path); toast('Link copied'); } catch (_) { toast(location.origin + path); } };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')} ${MON[m - 1]} ${y}`; };
export const fmtRange = (a, b) => (!a ? 'Dates not set' : a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
export const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
export const money = (n) => '$' + (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US');
export const stars = (n, big) => h('div', { class: 'stars', role: 'img', 'aria-label': `${n} of 5 stars` }, ...[1, 2, 3, 4, 5].map((i) => {
  const ic = icon('heart'); ic.innerHTML = '<path d="M12 3.5l2.600 5.400 5.900.8-4.300 4.100 1.100 5.800L12 16.800 6.700 19.600l1.100-5.800L3.500 9.700l5.900-.8z"/>'; if (i <= n) ic.classList.add('on'); return ic; }));
export const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 2592000) return Math.floor(s / 86400) + 'd ago'; return fmtDate(iso.slice(0, 10));
};
