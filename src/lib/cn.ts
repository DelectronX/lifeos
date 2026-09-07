type ClassValue = string | number | null | false | undefined | ClassValue[] | Record<string, boolean | undefined | null>;

/** Minimal classnames helper — no dependency, handles arrays and condition maps. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value));
    } else if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) out.push(nested);
    } else {
      for (const [key, on] of Object.entries(value)) if (on) out.push(key);
    }
  }
  return out.join(' ');
}
