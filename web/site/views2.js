import { h, icon, link, state, go, toast, attempt, refresh } from './core.js';
import { api } from './api.js';
import { page, img, avatar } from './views.js';
import { dialog, confirmBox } from './ui.js';
import { mountMap } from './map.js';
import { q, eImg, circleBtn, copyLink, fmtRange, money, stars, ago } from './util.js';

const costLabel = (c) => (c.kind === 'Plan template' ? `~$${c.cost} total` : c.cost ? `~$${c.cost}/day` : 'Free');
const hrefOf = (c) => (c.kind === 'Plan template' ? `/trip/${c.id}` : `/place/${c.id}`);

// ───────────────────────────── profile
function profileShell(p, own, rightPanel) {
  const side = h('aside', { class: 'pside' }, avatar(p, 'avatar'), h('h1', {}, p.name));
  if (own) side.append(h('div', { class: 'email' }, p.email),
    h('button', { class: 'btn', type: 'button', onclick: async () => {
      const r = await dialog({ title: 'Edit your profile', ok: 'Save', fields: [{ name: 'name', label: 'Display name', value: p.name, max: 60, required: true }] });
      if (r && r.name !== p.name && await attempt(() => api.patch('/me', { name: r.name }), 'Profile updated')) { await refresh(); go('/profile', true); }
    } }, icon('pencil'), 'EDIT YOUR PROFILE'));
  else {
    const b = h('button', { class: 'btn', type: 'button', style: { width: '136px' }, onclick: async () => {
      if (!state.me) { sessionStorage.setItem('next', location.pathname); return go('/login'); }
      const on = p.iFollow;
      if (await attempt(() => (on ? api.del(`/follow/${p.id}`) : api.put(`/follow/${p.id}`)), on ? `Unfollowed ${p.name}` : `Following ${p.name}`)) { p.iFollow = !on; b.textContent = p.iFollow ? 'Unfollow' : 'Follow'; await refresh(); }
    } }, p.iFollow ? 'Unfollow' : 'Follow');
    side.append(h('div', { class: 'email' }, `${p.followers} follower${p.followers === 1 ? '' : 's'} · ${p.following} following`), b);
  }
  return h('section', { class: 'profile' }, side, rightPanel);
}

export function profileView() {
  const s = state; const me = s.me;
  const tab = q().get('tab') || 'trip';
  const tabs = [['trip', 'MY TRIP'], ['wishlist', 'WISHLIST'], ['following', 'FOLLOWING'], ['follower', 'FOLLOWER']];
  const list = h('div', { class: 'list' });
  const search = h('input', { type: 'text', placeholder: 'Search Here', 'aria-label': 'Search', autocomplete: 'off' });
  const tripFilter = h('select', { class: 'select', 'aria-label': 'Trip status', style: { width: '145px' }, onchange: () => draw() }, ...['Upcoming', 'Past', 'All'].map((o) => h('option', {}, o)));
  const wishFilter = h('select', { class: 'select', 'aria-label': 'Kind', style: { width: '108px' }, onchange: () => draw() }, ...['All', 'Country', 'Place', 'Plan template'].map((o) => h('option', {}, o)));
  function tripRow(t) {
    const mine = t.ownerId === me.id;
    const act = mine
      ? circleBtn('trash', 'Delete trip', async () => { if (await confirmBox('Delete this trip?', `“${t.name}” will be removed for you and everyone you shared it with. This can’t be undone.`, 'Delete trip') && await attempt(() => api.del(`/trips/${t.id}`), 'Trip deleted')) { await refresh(); draw(); } })
      : circleBtn('x', 'Leave this trip', async () => { if (await confirmBox('Leave this trip?', `“${t.name}” stays with ${t.ownerName}. You can be invited again.`, 'Leave') && await attempt(() => api.del(`/trips/${t.id}/members/${me.id}`), 'You left the trip')) { await refresh(); draw(); } });
    return h('div', { class: 'trow' },
      eImg(t.img || 1737, 'thumb', t.name),
      h('div', { class: 'info' },
        h('div', {}, link(`/trip/${t.id}`, {}, h('h3', {}, t.name)), h('span', { class: 'badge' }, t.status), t.public ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'Public') : null, !mine ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, `by ${t.ownerName}`) : null),
        h('p', {}, t.desc || `${t.stops} stop${t.stops === 1 ? '' : 's'} planned.`), h('div', { class: 'sched' }, h('b', {}, 'schedule'), ' : ' + fmtRange(t.from, t.to)),
        h('div', { class: 'chips' }, h('span', { class: 'chip fill' }, money(t.cost)), t.season ? h('span', { class: 'chip' }, t.season) : null)),
      h('div', { class: 'acts' }, circleBtn('share', t.public ? 'Copy link' : 'Share (make the trip public first)', () => (t.public ? copyLink(`/trip/${t.id}`) : toast('This trip is private. Open it and press the eye button to make it public.'))), act));
  }
  function wishRow(c) {
    return h('div', { class: 'trow pl' },
      eImg(c.thumb || c.img, 'thumb', c.title),
      h('div', { class: 'info' },
        h('div', {}, link(hrefOf(c), {}, h('h3', {}, c.title)), h('span', { class: 'badge' }, c.kind)),
        h('p', {}, c.summary), h('div', { class: 'chips' }, h('span', { class: 'chip fill' }, costLabel(c)), h('span', { class: 'chip' }, c.season), h('span', { class: 'chip' }, c.car))),
      h('div', { class: 'acts' }, circleBtn('share', 'Copy link', () => copyLink(hrefOf(c))),
        circleBtn('heart', 'Remove from wishlist', async () => { if (await attempt(() => api.del(`/wishlist/${c.id}`), 'Removed from wishlist')) { await refresh(); draw(); } }, 'circle-btn on')));
  }
  function personRow(p, kind) {
    const following = s.following.some((x) => x.id === p.id);
    const btn = kind === 'following'
      ? h('button', { class: 'fbtn', type: 'button', onclick: async () => { if (await attempt(() => api.del(`/follow/${p.id}`), `Unfollowed ${p.name}`)) { await refresh(); draw(); } } }, 'FOLLOWING')
      : h('div', { style: { display: 'flex', gap: '8px' } },
        !following ? h('button', { class: 'fbtn', type: 'button', onclick: async () => { if (await attempt(() => api.put(`/follow/${p.id}`), `Following ${p.name}`)) { await refresh(); draw(); } } }, 'FOLLOW BACK') : null,
        h('button', { class: 'fbtn', type: 'button', onclick: async () => { if (await attempt(() => api.del(`/followers/${p.id}`), `Removed ${p.name}`)) { await refresh(); draw(); } } }, 'REMOVE'));
    return h('div', { class: 'frow' }, avatar(p, 'fav'), link(`/u/${p.id}`, { style: { gridColumn: 4 } }, h('h3', { style: { gridColumn: 'auto' } }, p.name)), btn);
  }
  function draw() {
    const term = search.value.trim().toLowerCase(); let rows;
    if (tab === 'trip') {
      const f = tripFilter.value;
      rows = s.trips.filter((t) => t.name.toLowerCase().includes(term) && (f === 'All' || t.status === f)).map(tripRow);
    } else if (tab === 'wishlist') {
      rows = s.catalog.filter((c) => s.wishlist.includes(c.id) && c.title.toLowerCase().includes(term) && (wishFilter.value === 'All' || c.kind === wishFilter.value)).map(wishRow);
    } else {
      const people = tab === 'following' ? s.following : s.followers;
      rows = people.filter((p) => p.name.toLowerCase().includes(term)).map((p) => personRow(p, tab));
    }
    const empty = tab === 'trip' ? h('div', { class: 'empty' }, term ? 'No results for that search.' : 'No trips yet. ', term ? null : link('/trip/new', { style: { textDecoration: 'underline' } }, 'Plan your first trip'))
      : tab === 'wishlist' ? h('div', { class: 'empty' }, term ? 'No results for that search.' : 'Nothing saved yet. Tap the heart on a place in ', term ? null : link('/explore', { style: { textDecoration: 'underline' } }, 'Explore'), term ? null : '.')
        : h('div', { class: 'empty' }, term ? 'No results for that search.' : tab === 'following' ? 'You are not following anyone yet. Open a public trip and tap its owner to follow them.' : 'No followers yet.');
    list.replaceChildren(...(rows.length ? rows : [empty]));
  }
  search.addEventListener('input', draw);
  const row = h('div', { class: 'prow' }, h('label', { class: 'input-pill grow' }, icon('search'), search), tab === 'trip' ? tripFilter : tab === 'wishlist' ? wishFilter : null);
  draw();
  const panel = h('section', { class: 'ppanel' },
    h('div', { class: 'ptabs', role: 'tablist' },
      ...tabs.map(([k, label]) => h('button', { class: 'ptab', role: 'tab', 'aria-selected': String(tab === k), onclick: () => go('/profile' + (k === 'trip' ? '' : `?tab=${k}`)) }, label)),
      link('/trip/new', { class: 'btn create' }, 'CREATE TRIP', icon('plus'))),
    row, list);
  return page('profile', 'Profile', profileShell(me, true, panel));
}

export async function otherProfileView({ id }) {
  if (state.me && String(state.me.id) === id) return go('/profile', true) && null;
  const p = await api.get(`/users/${encodeURIComponent(id)}`);
  const list = h('div', { class: 'list' });
  const search = h('input', { type: 'text', placeholder: 'Search Here', 'aria-label': 'Search', autocomplete: 'off' });
  const draw = () => {
    const term = search.value.toLowerCase(); const rows = p.trips.filter((t) => t.name.toLowerCase().includes(term));
    list.replaceChildren(...(rows.length ? rows.map((t) => h('div', { class: 'trow' },
      eImg(t.img || 1737, 'thumb', t.name),
      h('div', { class: 'info' }, h('div', {}, link(`/trip/${t.id}`, {}, h('h3', {}, t.name)), h('span', { class: 'badge' }, t.status)),
        h('p', {}, t.desc || `${t.stops} stop${t.stops === 1 ? '' : 's'}.`), h('div', { class: 'sched' }, h('b', {}, 'schedule'), ' : ' + fmtRange(t.from, t.to)),
        h('div', { class: 'chips' }, h('span', { class: 'chip fill' }, money(t.cost)), t.season ? h('span', { class: 'chip' }, t.season) : null)),
      h('div', { class: 'acts' }, circleBtn('share', 'Copy link', () => copyLink(`/trip/${t.id}`))))) : [h('div', { class: 'empty' }, term ? 'No results for that search.' : `${p.name} has not shared any trips yet.`)]));
  };
  search.addEventListener('input', draw); draw();
  const panel = h('section', { class: 'ppanel' }, h('div', { class: 'ptabs' }, h('button', { class: 'ptab', 'aria-selected': 'true' }, `${p.name}’s trips`.toUpperCase())),
    h('div', { class: 'prow' }, h('label', { class: 'input-pill grow' }, icon('search'), search)), list);
  const sh = profileShell(p, false, panel); sh.classList.add('other'); return page('profile', p.name, sh);
}

// ───────────────────────────── explore
export function exploreView() {
  const s = state;
  const grid = h('div', { class: 'xgrid' });
  const search = h('input', { type: 'text', placeholder: 'Search Here', 'aria-label': 'Search places and plans', autocomplete: 'off' });
  const kind = h('select', { class: 'select', 'aria-label': 'Kind', onchange: draw }, h('option', { value: 'All' }, 'Everything'), h('option', { value: 'Country' }, 'Only countries'), h('option', { value: 'Place' }, 'Only places'), h('option', { value: 'Plan template' }, 'Only plans'));
  let onlyWish = false;
  const fbtn = circleBtn('filter', 'Show wishlist only', () => { if (!s.me) { sessionStorage.setItem('next', '/explore'); return go('/login'); } onlyWish = !onlyWish; fbtn.classList.toggle('on', onlyWish); fbtn.setAttribute('aria-pressed', String(onlyWish)); draw(); });
  function draw() {
    const term = search.value.trim().toLowerCase();
    const shown = s.catalog.filter((c) => c.explore && (c.title + ' ' + c.summary).toLowerCase().includes(term) && (kind.value === 'All' || c.kind === kind.value) && (!onlyWish || s.wishlist.includes(c.id)));
    grid.replaceChildren(...(shown.length ? shown.map((c) => {
      const on = s.wishlist.includes(c.id);
      const heart = h('button', { class: 'heart' + (on ? ' on' : ''), type: 'button', 'aria-label': on ? 'Remove from wishlist' : 'Add to wishlist', 'aria-pressed': String(on), onclick: async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!s.me) { sessionStorage.setItem('next', '/explore'); toast('Sign in to save places'); return go('/login'); }
        if (await attempt(() => (on ? api.del(`/wishlist/${c.id}`) : api.put(`/wishlist/${c.id}`)), on ? 'Removed from wishlist' : 'Added to wishlist')) { await refresh(); draw(); } } }, icon('heart'));
      return link(hrefOf(c), { class: 'xcard' },
        eImg(c.img, 'bg'), h('div', { class: 'top' }, h('span', { class: 'kind' }, c.kind), heart),
        h('div', { class: 'txt' }, h('h2', {}, c.title), h('p', {}, c.summary)),
        h('div', { class: 'tags' }, h('span', {}, costLabel(c)), h('span', { class: 'k' }, c.season), h('span', { class: 'k' }, c.car)));
    }) : [h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'No matches. Try another search or pick Everything.')]));
  }
  search.addEventListener('input', draw); draw();
  return page('explore', 'Explore',
    h('section', { class: 'explore' },
      h('h1', {}, 'Explore'),
      h('p', { class: 'lead' }, 'Discover places and ready-made plans. Save the ones you like with the heart, or open a plan and use it as the start of your own trip.'),
      h('div', { class: 'tools' }, h('label', { class: 'input-pill' }, icon('search'), search), kind, fbtn),
      grid));
}

// ───────────────────────────── place
export async function placeView({ id }) {
  const c = await api.get(`/catalog/${encodeURIComponent(id)}`);
  if (c.kind === 'Plan template') return go(`/trip/${c.id}`, true) && null;
  const me = state.me;
  const reviews = h('div', { class: 'rev' });
  const drawReviews = (list) => {
    reviews.replaceChildren(...(list.length ? list.map((r) => h('div', { class: 'review' }, h('div', { class: 'txt' }, r.body), stars(r.rating),
      h('div', { class: 'who' }, avatar({ name: r.name, picture: r.picture }, 'round'), link(`/u/${r.userId}`, {}, '@' + r.name.replace(/\s+/g, '').toLowerCase()), h('small', { style: { marginLeft: '10px', color: '#64748b' } }, ago(r.created)),
        (r.mine || (me && me.staff && state.me.perms.Users && state.me.perms.Users[3])) ? h('button', { class: 'linkbtn', type: 'button', style: { marginLeft: 'auto' }, onclick: async () => { if (await confirmBox('Delete this review?', 'It will be removed for everyone.', 'Delete') && await attempt(() => api.del(`/reviews/${r.id}`), 'Review deleted')) go(location.pathname, true); } }, 'Delete') : null)))
      : [h('p', { class: 'a-m', style: { margin: '12px 0' } }, 'No reviews yet. Be the first to share what you thought.')]));
  };
  drawReviews(c.reviews);
  const form = (() => {
    if (!me) return h('p', { class: 'a-m' }, link('/login', { style: { textDecoration: 'underline' }, onclick: () => sessionStorage.setItem('next', location.pathname) }, 'Sign in'), ' to write a review.');
    const mine = c.reviews.find((r) => r.mine); let rating = mine ? mine.rating : 0;
    const body = h('textarea', { class: 'tdesc', rows: '3', maxlength: '400', placeholder: 'What should other travelers know?', 'aria-label': 'Your review', style: { minHeight: '84px', height: '84px' } }, mine ? mine.body : '');
    const starRow = h('div', { class: 'starpick', role: 'radiogroup', 'aria-label': 'Rating' });
    const drawStars = () => starRow.replaceChildren(...[1, 2, 3, 4, 5].map((i) => { const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(rating === i), 'aria-label': `${i} star${i > 1 ? 's' : ''}`, class: i <= rating ? 'on' : '', onclick: () => { rating = i; drawStars(); } }, '★'); return b; }));
    drawStars();
    return h('form', { class: 'rform', onsubmit: async (e) => { e.preventDefault(); if (!rating) return toast('Pick a star rating first', 'err'); if (body.value.trim().length < 3) return toast('Write at least a few words', 'err');
      if (await attempt(() => api.put(`/catalog/${c.id}/review`, { rating, body: body.value }), 'Thanks for your review!')) go(location.pathname, true); } },
    h('h4', {}, mine ? 'Edit your review' : 'Write a review'), starRow, body, h('button', { class: 'btn', type: 'submit', style: { alignSelf: 'flex-start' } }, mine ? 'Update review' : 'Post review'));
  })();
  const el = h('div', { class: 'mapstrip', role: 'application', 'aria-label': `Map of ${c.title}` });
  if (c.lat != null) mountMap(el, { editable: false, pad: () => ({}) }).then((m) => { m.set([{ key: 'p', day: 0, name: c.title, lat: c.lat, lng: c.lng }], 'p'); m.map.setView([c.lat, c.lng], c.zoom || 12, { animate: false }); }).catch(() => el.replaceChildren(h('p', { class: 'map-fail' }, 'The map couldn’t load.')));
  const others = state.catalog.filter((x) => x.explore && x.id !== c.id);
  return page('explore', c.title, h('section', { class: 'place' },
    h('h1', {}, c.title), circleBtn('share', 'Copy link', () => copyLink(`/place/${c.id}`), 'circle-btn share'),
    ...c.about.map((t, i) => h('p', { class: 'big', style: { marginTop: i ? '28px' : '4px' } }, t)),
    h('div', { class: 'chips', style: { margin: '18px 0 0' } }, h('span', { class: 'chip fill' }, costLabel(c)), h('span', { class: 'chip' }, 'Best: ' + c.season), h('span', { class: 'chip' }, c.car)),
    c.why ? [h('h3', { class: 'h' }, 'Why you go here ?'), h('p', { class: 'big' }, c.why)] : null,
    c.know ? [h('h3', { class: 'h', style: { marginTop: '31.3px' } }, 'What you must know before ?'), h('p', { class: 'big' }, c.know)] : null,
    c.photos.length ? h('div', { class: 'strip' }, ...c.photos.slice(0, 5).map((x) => eImg(x, '', c.title))) : null,
    el,
    h('h3', { class: 'h', style: { marginBottom: '0', marginTop: '32px' } }, `Review${c.avg ? ` · ${c.avg} / 5` : ''}`), reviews, form,
    others.length ? [h('h3', { style: { font: '400 20px/24px var(--display)', margin: '32px 0 0' } }, 'Recommend'),
      h('div', { class: 'recrow' }, ...others.slice(0, 4).map((x) => link(`${x.kind === 'Plan template' ? '/trip/' : '/place/'}${x.id}`, { style: { textDecoration: 'none', color: 'inherit' } }, eImg(x.thumb || x.img, '', x.title), h('b', {}, x.title.length > 18 ? x.title.slice(0, 16) + '…' : x.title))))] : null));
}
