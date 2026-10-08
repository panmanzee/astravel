// Thin fetch wrapper for the ASTRAVEL API. Same-origin cookie session; every write carries a header that cross-site pages can't send.
export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

function messageOf(data) {
  if (!data) return '';
  if (typeof data === 'string') return '';
  const d = data.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) {
    const e = d[0]; const field = (e.loc || []).filter((x) => x !== 'body' && typeof x === 'string').pop();
    let m = String(e.msg || 'Invalid value').replace(/^Value error, /, '');
    if (e.type === 'string_too_short') m = `must be at least ${e.ctx?.min_length} characters`;
    else if (e.type === 'string_too_long') m = `must be at most ${e.ctx?.max_length} characters`;
    return field && !/^[A-Z]/.test(m) ? `${field}: ${m}` : m;
  }
  return '';
}

async function call(method, path, body) {
  let r;
  try {
    r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'X-Requested-With': 'astravel', 'Content-Type': 'application/json' } : { 'X-Requested-With': 'astravel' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (_) { throw new ApiError('Can’t reach the server. Check your connection and try again.', 0); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => null) : null;
  if (!r.ok) throw new ApiError(messageOf(data) || (r.status === 503 ? 'The site is under maintenance. Please come back soon.' : r.status === 429 ? 'Too many requests. Please wait a moment.' : `Something went wrong (${r.status}).`), r.status);
  return data;
}
export const api = {
  get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b),
  patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p),
};
