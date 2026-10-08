// Trip planner: create / edit / view a trip, and view a ready-made plan template.
import { h, icon, link, state, go, toast, attempt, refresh } from './core.js';
import { api } from './api.js';
import { page, avatar } from './views.js';
import { dialog, confirmBox } from './ui.js';
import { mountMap, findPlace } from './map.js';
import { q, eImg, circleBtn, copyLink, fmtDate, todayIso, addDays, money } from './util.js';

const MODES = ['Walk', 'By car', 'By train', 'By bus', 'By bike', 'Flight', 'Boat'];
const CATS = ['food', 'transport', 'stay', 'tickets', 'shopping', 'other'];
const cacheCat = new Map();
const catalogItem = async (id) => { if (!cacheCat.has(id)) cacheCat.set(id, api.get(`/catalog/${encodeURIComponent(id)}`).catch(() => null)); return cacheCat.get(id); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const matchCatalog = (name) => { const n = (name || '').trim().toLowerCase(); return n ? state.catalog.find((c) => c.kind !== 'Plan template' && (c.title.toLowerCase() === n || (n.length > 4 && c.title.toLowerCase().includes(n)))) : null; };

export function tripView(mode) {
  return async ({ id }) => {
    const me = state.me;
    // ───── load
    let T; let isTemplate = false; let tplItem = null;
    if (mode === 'create') {
      const from = q().get('from');
      if (from) {
        const tpl = await api.get(`/catalog/${encodeURIComponent(from)}`);
        const start = addDays(todayIso(), 14);
        T = { name: tpl.title, desc: tpl.summary, tags: [], days: clone(tpl.days || []).map((d, i) => ({ ...d, date: addDays(start, i) })), budget: clone(tpl.budget || []), members: [], owner: me, isOwner: true, canEdit: true, public: false };
      } else T = { name: '', desc: '', tags: [], days: [{ date: addDays(todayIso(), 7), stops: [] }], budget: [], members: [], owner: me, isOwner: true, canEdit: true, public: false };
    } else if (state.catalog.some((c) => c.id === id && c.kind === 'Plan template')) {
      tplItem = await api.get(`/catalog/${encodeURIComponent(id)}`); isTemplate = true;
      T = { name: tplItem.title, desc: tplItem.about.join('\n\n'), tags: [tplItem.season, tplItem.car], days: clone(tplItem.days || []), budget: clone(tplItem.budget || []), members: [], owner: null, isOwner: false, canEdit: false, public: true };
    } else {
      T = await api.get(`/trips/${encodeURIComponent(id)}`);
      T.desc = T.desc || '';
    }
    if (mode === 'edit' && !T.canEdit) return go(`/trip/${id}`, true) && null;
    const editing = mode === 'create' || (mode === 'edit' && T.canEdit);
    let dirty = false; let picked = null; let ptab = 'about'; let mapCtl = null; let saving = false;
    const touch = () => { dirty = true; syncMap(); };
    const root = h('section', { class: 'trip' });
    const people = () => [T.owner, ...(T.members || [])].filter(Boolean);
    const allStops = () => T.days.flatMap((d, di) => d.stops.map((st, si) => ({ key: di + ':' + si, day: di, name: st.name, lat: st.lat, lng: st.lng })));
    const selKey = () => { const all = allStops(); return (all.find((x) => x.name === picked && x.lat != null) || {}).key; };
    const syncMap = (fit) => { if (!mapCtl) return; mapCtl.set(allStops(), selKey()); if (fit) mapCtl.fit(); };
    const refreshLists = () => root.querySelectorAll('.tpanel .scroll').forEach((w) => w.redraw && w.redraw());
    const refreshCard = () => { const c = root.querySelector('.pcard'); if (c && c.refresh) c.refresh(); };
    picked = (T.days[0] && T.days[0].stops[0] && T.days[0].stops[0].name) || null;
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', warn); const off = () => removeEventListener('beforeunload', warn);
    addEventListener('popstate', off, { once: true });

    const stopOf = (name) => { for (const d of T.days) for (const s of d.stops) if (s.name === name) return s; return null; };
    const addStop = (name, lat, lng, note) => {
      let d = T.days[T.days.length - 1]; if (!d) { d = { date: addDays(todayIso(), 7), stops: [] }; T.days.push(d); }
      d.stops.push({ name: name.slice(0, 80), lat, lng, note: (note || '').slice(0, 400), time: '09:00 - 11:00', mode: 'Walk', cost: 0, done: false });
      picked = name; touch(); refreshLists(); refreshCard(); if (mapCtl && lat != null) mapCtl.flyTo(lat, lng); toast(`Added ${name}`);
    };
    const payload = (pub) => ({ name: (T.name || '').trim() || 'My trip', desc: T.desc || '', tags: T.tags, public: pub ?? T.public,
      days: T.days.map((d) => ({ date: d.date || null, stops: d.stops.map((s) => ({ name: s.name, lat: s.lat ?? null, lng: s.lng ?? null, note: s.note || '', time: s.time || '', mode: s.mode, cost: +s.cost || 0, done: !!s.done })) })),
      budget: T.budget.map((b) => ({ name: b.name, cat: b.cat || 'other', amount: +b.amount || 0, who: b.who ?? null })) });
    async function saveTrip() {
      if (saving) return; if (!(T.name || '').trim()) { toast('Give your trip a name first', 'err'); root.querySelector('.ttl')?.focus(); return; }
      saving = true;
      try {
        if (mode === 'create') { const r = await attempt(() => api.post('/trips', payload()), 'Trip created'); if (r) { dirty = false; off(); await refresh(); go(`/trip/${r.id}`); } }
        else if (await attempt(() => api.put(`/trips/${id}`, payload()), 'Saved')) { dirty = false; off(); await refresh(); go(`/trip/${id}`); }
      } finally { saving = false; }
    }
    let doneTimer; const saveDone = () => { clearTimeout(doneTimer); doneTimer = setTimeout(() => attempt(() => api.put(`/trips/${id}`, payload())), 700); };

    // ───── header
    const header = () => {
      const av = people().map((p) => avatar(p, 'av'));
      const invite = circleBtn('plus', 'Invite a friend by email', async () => {
        if (mode === 'create') return toast('Create the trip first, then invite friends.');
        const r = await dialog({ title: 'Invite a friend', body: 'They need an ASTRAVEL account. They will be able to view and edit this trip.', ok: 'Invite', fields: [{ name: 'email', label: 'Friend’s email', type: 'email', max: 120, required: true }] });
        if (r && await attempt(() => api.post(`/trips/${id}/members`, { email: r.email }), 'Friend added')) { go(location.pathname + location.search, true); }
      });
      const eye = T.isOwner && mode !== 'create'
        ? circleBtn('eye', T.public ? 'Public. Anyone with the link can view. Press to make private' : 'Private. Press to make public', async () => {
          const next = !T.public;
          if (!(await confirmBox(next ? 'Make this trip public?' : 'Make this trip private?', next ? 'Anyone with the link can view it, and it appears on your profile. Only you and your invited friends can edit.' : 'Only you and the friends you invited will be able to open it.', next ? 'Make public' : 'Make private'))) return;
          if (await attempt(() => api.put(`/trips/${id}`, payload(next)), next ? 'Trip is public' : 'Trip is private')) { T.public = next; go(location.pathname + location.search, true); }
        }, 'circle-btn' + (T.public ? ' on' : ''))
        : circleBtn('eye', mode === 'create' ? 'Preview after you create the trip' : 'View', () => (mode === 'create' ? toast('Create the trip to preview it') : go(`/trip/${id}`)), 'circle-btn');
      let right;
      if (isTemplate) right = [h('button', { class: 'btn primary', type: 'button', onclick: () => { if (!state.me) { sessionStorage.setItem('next', `/trip/new?from=${id}`); return go('/login'); } go(`/trip/new?from=${id}`); } }, 'START WITH THIS TEMPLATE')];
      else if (editing) right = [...av, mode === 'create' ? null : invite, eye, h('button', { class: 'btn primary', type: 'button', onclick: saveTrip }, mode === 'create' ? 'CREATE' : 'SAVE', icon(mode === 'create' ? 'plus' : 'save'))];
      else right = [...av, T.isOwner ? invite : null, eye, T.canEdit ? circleBtn('pencil', 'Edit trip', () => go(`/trip/${id}/edit`)) : null];
      const ttl = editing ? h('input', { class: 'ttl', value: T.name, placeholder: 'Trip name', 'aria-label': 'Trip name', maxlength: '60', oninput: (e) => { T.name = e.target.value; dirty = true; } })
        : h('h1', { style: { font: '400 57px/70px var(--display)', margin: 0 } }, T.name || 'Trip name');
      return h('div', { class: 'thead' }, ttl, h('div', { class: 'ctl' }, ...right));
    };
    const tagRow = () => {
      const row = h('div', { class: 'tagrow' });
      const draw = () => {
        row.replaceChildren(editing ? h('span', { class: 'lbl' }, 'Tag :') : null,
          ...T.tags.map((t, i) => editing ? h('button', { class: 'pill-o', type: 'button', title: 'Click to remove', onclick: () => { T.tags.splice(i, 1); touch(); draw(); } }, t) : h('span', { class: 'pill-o' }, t)),
          editing && T.tags.length < 12 ? circleBtn('plus', 'Add tag', () => {
            const inp = h('input', { class: 'pill-o in', placeholder: 'New tag', maxlength: '24', 'aria-label': 'New tag' });
            const commit = () => { const v = inp.value.trim(); if (v) T.tags.push(v); touch(); draw(); };
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') draw(); }); inp.addEventListener('blur', commit);
            row.append(inp); inp.focus(); }, 'circle-s') : null);
      }; draw(); return row;
    };

    // ───── itinerary
    const dayTitle = (d, di) => (d.date ? fmtDate(d.date) : `Day ${di + 1}`);
    const stopEl = (d, di, st, si, redraw) => {
      const pin = icon('pin', 'pin'); pin.innerHTML = '<path d="M12 22s-7-6.200-7-12a7 7 0 0 1 14 0c0 5.800-7 12-7 12z"/><circle cx="12" cy="10" r="2.600"/>';
      const nm = h('div', { class: 'nm' }, pin,
        editing ? h('input', { value: st.name, 'aria-label': 'Place name', maxlength: '80', style: { font: 'inherit', border: 0, borderBottom: '1px dashed var(--blue)', background: 'transparent', outline: 0, width: '60%' },
          oninput: (e) => { st.name = e.target.value; picked = st.name; dirty = true; },
          onchange: async (e) => { const qn = e.target.value.trim(); if (!qn) return; try { const r = await findPlace(qn); if (r) { st.lat = r.lat; st.lng = r.lng; touch(); refreshCard(); if (mapCtl) mapCtl.flyTo(r.lat, r.lng); } else toast(`Couldn’t find “${qn}” on the map. Tap the map to drop a pin instead.`); } catch (_) { toast('Place search is unavailable right now.', 'err'); } } })
          : h('button', { type: 'button', style: { all: 'unset', cursor: 'pointer' }, onclick: () => { picked = st.name; redraw(); refreshCard(); if (mapCtl) mapCtl.select(selKey(), true); } }, st.name));
      const open = async () => {
        const r = await dialog({ title: 'Stop details', body: st.name, ok: 'Save', fields: [
          { name: 'time', label: 'Time', value: st.time, placeholder: 'e.g. 09:00 - 11:00', max: 24 },
          { name: 'mode', label: 'Getting there', type: 'select', value: MODES.includes(st.mode) ? st.mode : MODES[0], options: MODES },
          { name: 'cost', label: 'Cost ($)', type: 'number', value: st.cost, min: 0 },
          { name: 'note', label: 'Note', value: st.note || '', placeholder: 'Opening hours, what to do…', max: 200 }] });
        if (r) { Object.assign(st, { time: r.time, mode: r.mode, cost: +r.cost, note: r.note }); touch(); redraw(); refreshCard(); }
      };
      const pill = (txt, cls) => editing ? h('button', { class: cls, type: 'button', title: 'Edit stop details', onclick: open }, txt) : h('span', { class: cls }, txt);
      return h('div', { class: 'stop' + (!editing && st.done ? ' done' : '') },
        editing ? h('span', { class: 'grip' }, icon('grip')) : null, nm,
        editing ? circleBtn('trash', 'Remove stop', () => { d.stops.splice(si, 1); touch(); redraw(); refreshCard(); }, 'circle-m del')
          : (T.canEdit ? h('button', { class: 'circle-m check' + (st.done ? ' on' : ''), type: 'button', 'aria-label': st.done ? 'Mark as not done' : 'Mark as done', 'aria-pressed': String(!!st.done), onclick: () => { st.done = !st.done; saveDone(); redraw(); } }, icon('check')) : null),
        st.note ? h('p', { class: 'note' }, st.note) : null,
        h('div', { class: 'tags' }, pill(st.time || 'Time not set', 'pill-o'), pill(st.mode, 'pill-o'), pill(money(st.cost), 'pill-o fill')));
    };
    const suggestions = state.catalog.filter((c) => c.suggest);
    const leftBody = () => {
      const wrap = h('div', { class: 'scroll' });
      const draw = () => {
        const kids = [];
        T.days.forEach((d, di) => {
          kids.push(h('div', { class: 'day' }, h('h3', {}, dayTitle(d, di)), editing ? h('div', { class: 'acts' },
            circleBtn('pencil', 'Change the date', async () => { const r = await dialog({ title: 'Change date', ok: 'Save', fields: [{ name: 'date', label: 'Day', type: 'date', value: d.date || todayIso(), required: true, max: 12 }] }); if (r && r.date) { d.date = r.date; touch(); draw(); } }, 'circle-m'),
            circleBtn('trash', 'Remove this day', async () => { if (T.days.length < 2) return toast('A trip needs at least one day'); if (!d.stops.length || await confirmBox('Remove this day?', `${d.stops.length} stop${d.stops.length > 1 ? 's' : ''} will be removed.`, 'Remove')) { T.days.splice(di, 1); touch(); draw(); refreshCard(); } }, 'circle-m')) : null));
          if (!d.stops.length) kids.push(h('p', { class: 'a-m', style: { margin: '6px 0 14px 4px' } }, editing ? 'No stops yet. Search for a place above the map, tap the map, or pick a suggestion below.' : 'No stops planned for this day.'));
          d.stops.forEach((st, si) => kids.push(stopEl(d, di, st, si, draw)));
        });
        if (editing) {
          if (suggestions.length) kids.push(h('div', { class: 'rhead' }, 'Recommend'), h('div', { class: 'recrow' }, ...suggestions.map((c) => h('div', {}, eImg(c.thumb || c.img, '', c.title), h('b', {}, c.suggest),
            circleBtn('plus', `Add ${c.title} to the trip`, () => addStop(c.title, c.lat, c.lng, c.summary.split('. ')[0].slice(0, 160)), 'circle-btn')))));
          kids.push(h('div', { class: 'addrow' }, circleBtn('plus', 'Add a day', () => { const last = T.days[T.days.length - 1]; T.days.push({ date: addDays(last && last.date ? last.date : todayIso(), 1), stops: [] }); touch(); draw(); }, 'circle-m')));
        }
        kids.push(budgetEl());
        wrap.replaceChildren(...kids);
      };
      wrap.redraw = draw; draw(); return wrap;
    };
    const total = () => T.budget.reduce((a, b) => a + (+b.amount || 0), 0);
    function budgetEl() {
      const box = h('div', { class: 'budget' + (editing ? '' : ' v') + (isTemplate ? ' t' : '') });
      const draw = () => {
        const tot = h('span', { class: 'chip-n' }, String(Math.round(total() * 100) / 100), icon('dollar'));
        const pool = people();
        box.replaceChildren(
          h('div', { class: 'bh' }, h('h3', {}, editing ? 'Budgeting' : 'Cost'), h('div', { class: 'tot' }, tot, editing ? circleBtn('plus', 'Add an expense', async () => {
            const r = await dialog({ title: 'Add an expense', ok: 'Add', fields: [{ name: 'name', label: 'What for?', value: picked || '', max: 80, required: true }, { name: 'cat', label: 'Category', type: 'select', value: 'food', options: CATS }, { name: 'amount', label: 'Amount ($)', type: 'number', value: 10, min: 0 }] });
            if (r) { T.budget.push({ name: r.name, cat: r.cat, amount: +r.amount, who: null }); touch(); draw(); } }, 'circle-m') : null)),
          ...(T.budget.length ? T.budget.map((b, i) => h('div', { class: 'bitem' },
            h('div', { class: 'bn' }, b.name), h('div', { class: 'bc' }, b.cat),
            h('div', { class: 'r' },
              editing ? h('label', { class: 'chip-n sm' }, h('input', { type: 'number', value: b.amount, min: '0', 'aria-label': 'Amount', style: { width: '56px', border: 0, background: 'none', outline: 0, color: 'inherit', font: 'inherit', textAlign: 'right' }, oninput: (e) => { b.amount = +e.target.value || 0; tot.firstChild.textContent = String(Math.round(total() * 100) / 100); dirty = true; } }), icon('dollar'))
                : h('span', { class: 'chip-n sm' }, String(b.amount), icon('dollar')),
              editing ? circleBtn('trash', 'Remove expense', () => { T.budget.splice(i, 1); touch(); draw(); }, 'circle-m') : null),
            !isTemplate && (editing || T.canEdit) && pool.length > 1 ? h('div', { class: 'who' }, b.who ? avatar(pool.find((p) => p.id === b.who) || { name: '?' }, 'round') : null,
              circleBtn('plus', 'Assign to a friend', () => { const ids = pool.map((p) => p.id); b.who = ids[(ids.indexOf(b.who) + 1) % ids.length]; touch(); draw(); if (!editing) saveDone(); }, 'circle-m')) : (b.who ? h('div', { class: 'who' }, avatar(pool.find((p) => p.id === b.who) || { name: '?' }, 'round')) : null)))
            : [h('p', { class: 'a-m', style: { margin: '12px 4px' } }, editing ? 'No expenses yet. Add the costs you expect to pay.' : 'No costs added.')]));
      };
      draw(); return box;
    }

    // ───── place card (details of the selected stop)
    function placeCard() {
      const card = h('div', { class: 'pcard' });
      const draw = async () => {
        const st = picked ? stopOf(picked) : null;
        if (!st) { card.replaceChildren(h('div', { style: { padding: '24px' } }, h('h4', {}, 'Place details'), h('p', {}, 'Pick a stop in the list or on the map to see its details here.'))); return; }
        const cm = matchCatalog(st.name); const det = cm ? await catalogItem(cm.id) : null;
        if (picked !== st.name) return;
        card.replaceChildren(h('div', { style: { padding: '24px' } },
          h('h4', {}, st.name),
          h('div', { class: 'ptabs2', role: 'tablist' }, ['about', 'review'].map((k) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(ptab === k), onclick: () => { ptab = k; draw(); } }, k))),
          ptab === 'about' ? h('div', {},
            h('div', { class: 'chips', style: { margin: '10px 0 0' } }, h('span', { class: 'pill-o' }, st.time || 'Time not set'), h('span', { class: 'pill-o' }, st.mode), h('span', { class: 'pill-o fill' }, money(st.cost))),
            st.note ? h('p', {}, st.note) : null,
            det && det.photos.length ? h('div', { class: 'pics' }, ...det.photos.slice(0, 3).map((x) => eImg(x, 'round', det.title))) : null,
            det ? [h('p', {}, det.summary), det.why ? [h('h5', {}, 'Why you go here ?'), h('p', {}, det.why)] : null, det.know ? [h('h5', {}, 'What you must know before ?'), h('p', {}, det.know)] : null, link(`/place/${det.id}`, { style: { textDecoration: 'underline', display: 'inline-block', marginTop: '8px' } }, 'Open the full guide')]
              : h('p', { class: 'a-m' }, 'There is no ASTRAVEL guide for this place yet.'))
            : h('div', { class: 'rev-mini' }, det && det.reviews.length ? det.reviews.slice(0, 3).map((r) => h('div', {}, h('p', {}, `“${r.body}”`), h('p', { style: { color: 'var(--blue)', fontWeight: 700 } }, `@${r.name.replace(/\s+/g, '').toLowerCase()} · ${r.rating}/5`))) : h('p', { class: 'a-m' }, det ? 'No reviews yet.' : 'Reviews are available for places that have an ASTRAVEL guide.'))));
      };
      card.refresh = draw; draw(); return card;
    }
    function mapBar() {
      if (!editing) return null;
      const inp = h('input', { type: 'search', placeholder: 'Search a place to add', 'aria-label': 'Search a place to add to the trip', maxlength: '80', autocomplete: 'off' });
      return h('form', { class: 'mapbar', onsubmit: async (e) => { e.preventDefault(); const qn = inp.value.trim(); if (!qn) return; inp.disabled = true;
        try { const r = await findPlace(qn); if (r) { addStop(r.name, r.lat, r.lng); inp.value = ''; } else toast(`Couldn’t find “${qn}”. Try a more specific name.`, 'err'); } catch (_) { toast('Place search is unavailable right now.', 'err'); } finally { inp.disabled = false; inp.focus(); } } },
      h('label', { class: 'input-pill' }, icon('search'), inp), h('button', { class: 'btn', type: 'submit' }, 'Add'));
    }
    const mapEl = h('div', { class: 'tmap', role: 'application', 'aria-label': 'Trip map. Markers are the stops of your trip.' });

    // ───── assemble
    const descBlock = editing
      ? [h('p', { class: 'tdesc-l' }, 'description'), h('textarea', { class: 'tdesc', placeholder: 'What is this trip about?', 'aria-label': 'Description', maxlength: '600', oninput: (e) => { T.desc = e.target.value; dirty = true; } }, T.desc || '')]
      : [h('p', { class: 'tdesc-view' }, T.desc || 'No description.')];
    const byline = !isTemplate && T.owner && !editing ? h('p', { class: 'a-m', style: { margin: '0 0 8px' } }, 'Planned by ', link(`/u/${T.owner.id}`, { style: { textDecoration: 'underline' } }, T.owner.name), T.public ? ' · public trip' : ' · private trip') : null;
    root.replaceChildren(header(), byline, ...descBlock, tagRow(),
      h('div', { class: 'tmain' + (editing ? '' : ' view') },
        h('div', { class: 'tpanel left' + (editing ? '' : ' vm') }, leftBody()),
        h('div', { class: 'tright' }, mapBar(), mapEl, placeCard())));
    mountMap(mapEl, { editable: editing, pad: () => ({}),
      onSelect: (k) => { const [di, si] = k.split(':').map(Number); picked = T.days[di].stops[si].name; mapCtl.select(k); refreshCard(); },
      onMove: (k, lat, lng) => { const [di, si] = k.split(':').map(Number); const st = T.days[di].stops[si]; st.lat = lat; st.lng = lng; touch(); },
      onAdd: (lat, lng, name) => addStop(name, lat, lng) })
      .then((c) => { mapCtl = c; syncMap(true); })
      .catch(() => mapEl.replaceChildren(h('p', { class: 'map-fail' }, 'The map couldn’t load. Check your connection and refresh.')));
    return page('plan', T.name || 'Plan a trip', root);
  };
}
