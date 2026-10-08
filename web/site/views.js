import { h, icon, link, state, go, toast, refresh, attempt } from './core.js';
import { api } from './api.js';

export const img = (x, alt = '', props = {}) => h('img', { src: `/img/x${x}.webp`, alt, loading: 'lazy', decoding: 'async', ...props });

// Profile picture: the Google photo when there is one, otherwise the person's initials.
export function avatar(u, cls = '') {
  if (u && u.picture) return h('img', { class: 'ava round ' + cls, src: u.picture, alt: u.name || '', referrerpolicy: 'no-referrer', loading: 'lazy', onerror: (e) => { e.currentTarget.replaceWith(avatar({ name: u.name }, cls)); } });
  const ini = ((u && u.name) || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return h('span', { class: 'ava ini ' + cls, role: 'img', 'aria-label': (u && u.name) || 'User' }, ini);
}

// ---------- shell: navbar + footer, shared by every screen ----------
export function navbar(active) {
  const me = state.me;
  const lk = (href, label, key) => link(href, { class: active === key ? 'on' : '' }, label);
  const links = [lk('/plan', 'PLAN', 'plan'), lk('/explore', 'EXPLORE', 'explore'), lk('/#team', 'CONTACT', 'contact')];
  let right;
  if (me) {
    const menu = h('div', { class: 'menu', role: 'menu' },
      link('/profile', {}, 'My profile'), link('/plan', {}, 'Plan a trip'), link('/explore', {}, 'Explore'),
      me.staff ? link('/admin', {}, 'Admin console') : null,
      h('button', { type: 'button', onclick: async () => { await attempt(() => api.post('/auth/logout')); state.ready = false; sessionStorage.removeItem('next'); toast('Signed out'); await go('/'); } }, 'Sign out'));
    const btn = h('button', { class: 'pill', type: 'button', 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); menu.classList.toggle('open'); } }, me.name.split(' ')[0]);
    document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
    right = h('div', { class: 'menu-wrap' }, btn, menu);
  } else right = link('/login', { class: 'pill' }, 'GET START');
  return h('header', { class: 'nav' },
    link('/', { class: 'logo', 'aria-label': 'ASTRAVEL home' }, h('img', { src: '/img/logo.png', alt: '' }), h('span', {}, 'ASTRAVEL')),
    h('nav', { class: 'nav-links', 'aria-label': 'Main' }, ...links, right));
}
export const footer = () => h('footer', { class: 'foot' }, `© ${new Date().getFullYear()} ASTRAVEL. All rights reserved.`);
// Phone navigation: a bottom tab bar (thumb-reachable). Hidden on desktop by CSS; not shown on login/admin.
export function tabbar(active) {
  if (active === 'login' || String(active).startsWith('admin')) return null;
  const t = (href, ic, label, keys) => link(href, { class: keys.includes(active) ? 'on' : '', 'aria-current': keys.includes(active) ? 'page' : null }, icon(ic), h('span', {}, label));
  return h('nav', { class: 'tabbar', 'aria-label': 'Primary' },
    t('/explore', 'search', 'Explore', ['explore']), t('/plan', 'plus', 'Plan', ['plan']), t('/profile', 'pin', 'My trips', ['profile']), t('/#team', 'user', 'Team', ['contact']));
}
export function page(active, title, ...body) {
  const out = [navbar(active), h('main', { id: 'main' }, ...body), footer(), tabbar(active)].filter(Boolean);
  out.title = title; return out;
}

export function maintenanceView() {
  return page('maint', 'Maintenance', h('section', { class: 'login' }, h('h2', {}, 'We’ll be right back'),
    h('h1', { style: { fontSize: 'clamp(30px,8vw,57px)' } }, 'UNDER MAINTENANCE'),
    h('p', { class: 'lead', style: { maxWidth: '520px' } }, 'ASTRAVEL is being updated. Please try again in a few minutes.'),
    h('button', { class: 'btn', type: 'button', onclick: async () => { state.ready = false; await go(location.pathname, true); } }, 'Check again')));
}

// ---------- login / register ----------
let gsi;
function loadGoogle() {
  return (gsi ||= new Promise((res, rej) => {
    const s = h('script', { src: 'https://accounts.google.com/gsi/client', async: true, defer: true });
    s.onload = () => res(window.google); s.onerror = () => rej(new Error('Google sign-in could not be loaded')); document.head.append(s);
  }));
}

export function loginView() {
  if (state.me) { const next = sessionStorage.getItem('next') || '/profile'; sessionStorage.removeItem('next'); go(next, true); return null; }
  let mode = 'signin';
  const err = h('p', { class: 'lerr', role: 'alert' });
  const done = async () => {
    state.ready = false; await refresh();
    const next = sessionStorage.getItem('next') || '/'; sessionStorage.removeItem('next'); toast(`Welcome, ${state.me.name.split(' ')[0]}!`); go(next);
  };
  const failWith = (e) => { err.textContent = e.message || 'Something went wrong'; };
  const gbox = h('div', { class: 'gbox' });
  if (state.googleClientId) {
    loadGoogle().then((g) => {
      g.accounts.id.initialize({ client_id: state.googleClientId, ux_mode: 'popup', callback: async (resp) => {
        err.textContent = ''; try { await api.post('/auth/google', { credential: resp.credential }); await done(); } catch (e) { failWith(e); } } });
      g.accounts.id.renderButton(gbox, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'left', width: Math.min(300, innerWidth - 56) });
    }).catch(() => gbox.replaceChildren(h('p', { class: 'a-m' }, 'Google sign-in couldn’t load. Use your email below.')));
  } else gbox.replaceChildren(h('button', { class: 'btn google off', type: 'button', disabled: true, title: 'The site owner has not connected a Google client ID yet' }, 'Google sign-in is not set up yet'));
  const name = h('input', { class: 'lin', name: 'name', autocomplete: 'name', placeholder: 'Your name', maxlength: '60', 'aria-label': 'Your name' });
  const email = h('input', { class: 'lin', name: 'email', type: 'email', autocomplete: 'email', placeholder: 'Email', required: true, maxlength: '320', 'aria-label': 'Email' });
  const pw = h('input', { class: 'lin', name: 'password', type: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true, maxlength: '128', 'aria-label': 'Password' });
  const nameRow = h('label', { class: 'lrow', style: { display: 'none' } }, name);
  const submit = h('button', { class: 'btn', type: 'submit' }, 'SIGN IN');
  const toggle = h('button', { class: 'linkbtn', type: 'button' }, 'New here? Create an account');
  const sync = () => {
    const reg = mode === 'register';
    nameRow.style.display = reg ? '' : 'none'; submit.textContent = reg ? 'CREATE ACCOUNT' : 'SIGN IN'; pw.autocomplete = reg ? 'new-password' : 'current-password';
    pw.placeholder = reg ? 'Password (8+ characters)' : 'Password'; toggle.textContent = reg ? 'Have an account? Sign in' : 'New here? Create an account'; err.textContent = '';
  };
  toggle.addEventListener('click', () => { mode = mode === 'signin' ? 'register' : 'signin'; sync(); });
  const form = h('form', { class: 'lform', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (!email.value.trim() || !pw.value) { err.textContent = 'Enter your email and password.'; return; }
    if (mode === 'register' && !name.value.trim()) { err.textContent = 'Enter your name.'; name.focus(); return; }
    submit.disabled = true;
    try {
      if (mode === 'register') await api.post('/auth/register', { email: email.value.trim(), name: name.value.trim(), password: pw.value });
      else await api.post('/auth/login', { email: email.value.trim(), password: pw.value });
      await done();
    } catch (e2) { failWith(e2); } finally { submit.disabled = false; }
  } }, nameRow, h('label', { class: 'lrow' }, email), h('label', { class: 'lrow' }, pw), submit, err, toggle);
  return page('login', 'Login',
    h('section', { class: 'login' },
      h('h2', {}, 'Welcome back, traveler!'),
      h('h1', {}, 'LOGIN / REGISTER'),
      gbox, h('div', { class: 'or' }, h('span', {}, 'or use your email')), form));
}

// ---------- landing ----------
export function landingView() {
  const cat = (id) => state.catalog.find((c) => c.id === id) || {};
  const rc = (cls, x, badge, title, text, to) => link(to, { class: 'rcard ' + cls }, img(x, ''), h('span', { class: 'badge' }, badge), h('h3', {}, title), text ? h('p', {}, text) : null);
  return page('home', 'Plan your journey',
    h('section', { class: 'hero' },
      h('h1', {}, 'Plan your Journey', h('br'), 'Design your Trip'),
      h('p', {}, 'Plan your trip, discover new places, and create unforgettable memories. Make every journey simple, exciting, and uniquely yours.'),
      h('div', { class: 'cta' }, link('/plan', { class: 'btn' }, 'Get started'), h('a', { class: 'btn soft', href: '#can', onclick: (e) => { e.preventDefault(); document.getElementById('can').scrollIntoView({ behavior: 'smooth' }); } }, 'What can we do')),
      h('div', { class: 'hero-img' }, img(973, 'Fukuoka skyline at dusk', { loading: 'eager' }))),
    h('section', { class: 'sec can', id: 'can' },
      h('h2', {}, 'What can we do ?'),
      h('div', { class: 'can-grid' },
        h('div', {}, h('img', { src: '/img/icon-plan.png', alt: '' }), h('h3', {}, 'Find your plan'), h('p', {}, 'Discover travel plans that match your interests, budget, and style. Create your perfect itinerary.')),
        h('div', {}, h('img', { src: '/img/icon-cost.png', alt: '' }), h('h3', {}, 'Calculate  cost'), h('p', {}, 'Estimate your travel expenses and manage your budget for a stress-free trip.')),
        h('div', {}, h('img', { src: '/img/icon-share.png', alt: '' }), h('h3', {}, 'Share with friends'), h('p', {}, 'Plan together, share your itinerary, and make decisions with your friends along the way.'))),
      link('/plan', { class: 'btn' }, 'TRY', icon('arrow'))),
    h('section', { class: 'sec rec' },
      h('h2', {}, 'Recommend'),
      h('p', { class: 'lead' }, 'Discover places, activities, and unique experiences recommended based on your interests, travel style, and preferences for a more enjoyable journey.'),
      h('div', { class: 'rec-grid' },
        rc('big', 977, 'Country', 'JAPAN', cat('japan').summary, '/place/japan'),
        rc('col', 957, 'Plan template', 'Japan in one day', '', '/trip/template-japan'),
        rc('col', 953, 'Place', 'FUKU-OKA', '', '/place/fukuoka')),
      link('/explore', { class: 'btn' }, 'Explore', icon('arrow'))),
    h('section', { class: 'sec team', id: 'team' },
      h('h2', {}, 'Meet our team members'),
      h('p', { class: 'sub' }, 'Get to know our team.'),
      h('div', { class: 'team-grid' },
        ...[[937, 'Sheena Totsuki'], [969, 'Mimi Kagari'], [945, 'Omi'], [949, 'Ali Maud'], [933, 'Lizzy Seiran'], [929, 'Fran']].map(([x, n]) =>
          h('div', { class: 'member' }, img(x, n), h('h3', {}, n), h('h4', {}, '6701XXXX'))))),
    h('div', { class: 'land-end' }));
}
