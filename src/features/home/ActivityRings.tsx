/**
 * Concentric progress rings (the Apple Fitness idiom) for today's three
 * real completion measures. Each ring is a true ratio of the user's own
 * records — never a decorative number.
 */
export interface RingSpec {
  label: string;
  done: number;
  total: number;
  color: string;
  /** Text colour for the legend numeral when the ring colour is too dark for text. */
  textColor?: string;
}

export function ActivityRings({ rings, size = 132 }: { rings: RingSpec[]; size?: number }) {
  const stroke = size * 0.105;
  const gap = stroke * 0.18;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" role="img"
      aria-label={rings.map((r) => `${r.label} ${r.done} of ${r.total}`).join(', ')}>
      {rings.map((ring, i) => {
        const r = size / 2 - stroke / 2 - i * (stroke + gap);
        const c = 2 * Math.PI * r;
        const p = ring.total > 0 ? Math.min(1, ring.done / ring.total) : 0;
        return (
          <g key={ring.label}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ring.color} strokeOpacity={0.2} strokeWidth={stroke} />
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ring.color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - p)}
              style={{ transition: 'stroke-dashoffset 1100ms cubic-bezier(0.22,1,0.36,1)' }}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function RingLegend({ rings }: { rings: RingSpec[] }) {
  return (
    <dl className="grid gap-3">
      {rings.map((r) => (
        <div key={r.label}>
          <dt className="text-[0.8125rem] font-medium text-ink-muted">{r.label}</dt>
          <dd className="t-rounded t-num text-[1.375rem] font-semibold leading-tight tracking-[-0.02em]" style={{ color: r.textColor ?? r.color }}>
            {r.total === 0 ? <span className="text-ink-faint">—</span> : (
              <>{r.done}<span className="text-[0.9375rem] font-medium opacity-70">/{r.total}</span></>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
