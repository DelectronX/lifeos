/**
 * App accent color (Apple HIG: one app-wide tint for buttons, selection and
 * sidebar icons). Applied as `data-accent` on <html>; the CSS variables live in
 * index.css. A localStorage copy lets index.html set it before first paint.
 */
export const ACCENTS = [
  { id: 'blue', label: 'Blue', swatch: '#0071E3' },
  { id: 'indigo', label: 'Indigo', swatch: '#5856D6' },
  { id: 'purple', label: 'Purple', swatch: '#9D46CC' },
  { id: 'teal', label: 'Teal', swatch: '#40C8E0' },
  { id: 'green', label: 'Green', swatch: '#30D158' },
  { id: 'orange', label: 'Orange', swatch: '#FF9F0A' },
  { id: 'brass', label: 'Brass', swatch: '#D6B270' },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];

const KEY = 'lifeos.accent';

export function isAccent(v: unknown): v is AccentId {
  return typeof v === 'string' && ACCENTS.some((a) => a.id === v);
}

export function applyAccent(id: AccentId | undefined | null): void {
  const accent = isAccent(id) ? id : 'blue';
  if (accent === 'blue') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', accent);
  try { localStorage.setItem(KEY, accent); } catch { /* private mode */ }
}
