// In-site dialogs (replace the browser's native prompt/confirm). Accessible modal: focus trap, Esc, backdrop, Enter.
import { h } from './core.js';

let opened = 0;
export function dialog({ title, body, fields = [], ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const inputs = {};
    const uid = 'dlg' + Math.random().toString(36).slice(2, 7);
    const err = h('p', { class: 'dlg-err', role: 'alert' });
    const mk = (f) => {
      let el;
      if (f.type === 'select') el = h('select', { class: 'dlg-in select', id: `${uid}-${f.name}` }, ...f.options.map((o) => h('option', { value: o, selected: o === f.value ? '' : null }, o)));
      else el = h('input', { class: 'dlg-in', id: `${uid}-${f.name}`, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', maxlength: f.max || 40, min: f.min, inputmode: f.type === 'number' ? 'decimal' : null, autocomplete: 'off' });
      inputs[f.name] = el;
      return h('label', { class: 'dlg-f', for: el.id }, h('span', {}, f.label), el);
    };
    const finish = (val) => {
      document.removeEventListener('keydown', onKey, true); wrap.classList.add('out');
      if (--opened === 0) document.documentElement.classList.remove('dlg-open');
      setTimeout(() => { wrap.remove(); prev && prev.focus && prev.focus(); }, 160); resolve(val);
    };
    const submit = () => {
      const out = {};
      for (const f of fields) {
        let v = inputs[f.name].value.trim();
        if (f.type === 'number') { const n = Number(v); if (v === '' || !isFinite(n) || n < (f.min ?? -Infinity)) { err.textContent = `${f.label}: enter a valid number.`; inputs[f.name].focus(); return; } v = n; }
        else if (f.required && !v) { err.textContent = `${f.label} can’t be empty.`; inputs[f.name].focus(); return; }
        out[f.name] = v;
      }
      finish(out);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { e.preventDefault(); submit(); }
      else if (e.key === 'Tab') {
        const f = [...box.querySelectorAll('button,input,select')].filter((x) => !x.disabled); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const box = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': uid + '-t' },
      h('h2', { id: uid + '-t' }, title), body ? h('p', { class: 'dlg-body' }, body) : null,
      fields.length ? h('div', { class: 'dlg-fields' }, ...fields.map(mk)) : null, err,
      h('div', { class: 'dlg-act' },
        cancel ? h('button', { class: 'btn soft', type: 'button', onclick: () => finish(null) }, cancel) : null,
        h('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', onclick: submit }, ok)));
    const wrap = h('div', { class: 'dlg-wrap', onmousedown: (e) => { if (e.target === wrap) finish(null); } }, box);
    document.body.append(wrap); opened++; document.documentElement.classList.add('dlg-open');
    document.addEventListener('keydown', onKey, true);
    const first = fields.length ? inputs[fields[0].name] : box.querySelector('.btn:last-child');
    setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
  });
}
export const confirmBox = (title, body, ok = 'Delete') => dialog({ title, body, ok, danger: true }).then((v) => !!v);
