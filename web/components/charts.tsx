import { type ReactNode, useState } from 'react';

// Hand-written charts, no chart library. Jail colors checked with a palette validator against bg1
// (#161b22): lightness band, chroma, color-blind separation, contrast.
export const JAIL_PALETTE = ['#388bfd', '#db6d28', '#a371f7', '#2ea043'];
export const OTHER_COLOR = '#6e7681';
const PINNED = ['sshd', 'recidive'];

// A color follows its jail, never its rank: sshd and recidive always keep the first two colors, the
// other jails take the next ones by name. Past the palette they share the "other" gray rather than
// new hues nobody can tell apart.
export function jailColors(names: Iterable<string>) {
  const colors = new Map(PINNED.map((name, i) => [name, JAIL_PALETTE[i] ?? OTHER_COLOR]));
  const others = [...new Set(names)].filter((name) => !colors.has(name)).sort((a, b) => a.localeCompare(b));
  others.forEach((name, i) => {
    colors.set(name, JAIL_PALETTE[PINNED.length + i] ?? OTHER_COLOR);
  });
  return (name: string) => colors.get(name) ?? OTHER_COLOR;
}

export const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

export function Swatch({ color }: { color: string }) {
  return (
    <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: color }} />
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <li key={item.name} className="inline-flex items-center gap-1.5">
          <Swatch color={item.color} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

export type BarColumn = { key: string; label: string; parts: { name: string; value: number; color: string }[] };

// Columns of stacked parts, with a tooltip on hover or focus. The whole column height is the hit target.
export function StackedBars({
  columns,
  height = 160,
  label,
  axis,
}: {
  columns: BarColumn[];
  height?: number;
  label: string;
  axis?: ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...columns.map((c) => sum(c.parts.map((p) => p.value))));
  const shown = active === null ? undefined : columns[active];
  const left = active === null ? 0 : ((active + 0.5) / columns.length) * 100;

  return (
    <figure className="relative m-0">
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex items-end gap-0.5 border-border border-b" style={{ height }}>
        {columns.map((column, i) => {
          const parts = column.parts.filter((p) => p.value > 0);
          return (
            // A button per column: the tooltip opens on hover and on keyboard focus alike
            <button
              type="button"
              key={column.key}
              aria-label={`${column.label}: ${sum(parts.map((p) => p.value))}`}
              className={`flex h-full min-w-0 flex-1 cursor-default flex-col-reverse gap-px ${active === i ? 'bg-bg2/60' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              {parts.map((part, j) => (
                <div
                  key={part.name}
                  className={j === parts.length - 1 ? 'rounded-t-[3px]' : ''}
                  style={{ height: `${(part.value / max) * 100}%`, background: part.color }}
                />
              ))}
            </button>
          );
        })}
      </div>
      {axis}
      {shown && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-md border border-border bg-bg2 px-3 py-2 text-xs shadow-lg"
          style={{ left: `${left}%`, transform: `translateX(${left > 70 ? '-100%' : left < 30 ? '0' : '-50%'})` }}
        >
          <p className="mb-1 font-semibold">{shown.label}</p>
          {shown.parts
            .filter((p) => p.value > 0)
            .map((part) => (
              <p key={part.name} className="flex items-center justify-between gap-3 text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Swatch color={part.color} />
                  {part.name}
                </span>
                <span className="font-mono text-text">{part.value}</span>
              </p>
            ))}
          <p className="mt-1 flex justify-between border-border border-t pt-1">
            <span>Total</span>
            <span className="font-mono font-semibold">{sum(shown.parts.map((p) => p.value))}</span>
          </p>
        </div>
      )}
    </figure>
  );
}

// Labels under bars: first, middle and last column
export function BarAxis({ labels }: { labels: string[] }) {
  return (
    <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
      {labels.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
        <span key={i}>{l}</span>
      ))}
    </div>
  );
}

// Ring split into parts (a donut), surface-colored gaps between them, a figure in the middle
export function Donut({
  parts,
  size = 160,
  children,
}: {
  parts: { name: string; value: number; color: string }[];
  size?: number;
  children: ReactNode;
}) {
  const total = sum(parts.map((p) => p.value));
  let at = 0;
  const stops = parts.flatMap((part) => {
    const from = at;
    at += total ? (part.value / total) * 100 : 0;
    const gap = parts.length > 1 ? Math.min(0.8, (at - from) / 2) : 0;
    return [`${part.color} ${from}% ${at - gap}%`, `var(--color-bg1) ${at - gap}% ${at}%`];
  });
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: total ? `conic-gradient(${stops.join(', ')})` : 'var(--color-bg2)' }}
      />
      <div
        className="absolute flex flex-col items-center justify-center rounded-full bg-bg1"
        style={{ inset: size * 0.16 }}
      >
        {children}
      </div>
    </div>
  );
}

// One share against a whole: an arc on a gray track
export function Ring({
  percent,
  size = 120,
  color = 'var(--color-text)',
  thickness = 0.08,
  children,
}: {
  percent: number;
  size?: number;
  color?: string;
  thickness?: number;
  children: ReactNode;
}) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: `conic-gradient(${color} 0 ${p}%, var(--color-border) ${p}% 100%)` }}
      />
      <div
        className="absolute flex flex-col items-center justify-center rounded-full bg-bg1"
        style={{ inset: size * thickness }}
      >
        {children}
      </div>
    </div>
  );
}

// Ranked rows, the value in front of a bar filling the row
export function BarList({
  rows,
  fill = 'bg-accent/25',
  empty,
}: {
  rows: { key: string; label: ReactNode; value: number }[];
  fill?: string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.key} className="relative flex h-7 items-center gap-3 overflow-hidden rounded px-2 text-xs">
          <span
            className={`absolute inset-y-0 left-0 rounded ${fill}`}
            style={{ width: `${(row.value / max) * 100}%` }}
          />
          <span className="relative w-10 shrink-0 font-mono font-semibold">{row.value}</span>
          <span className="relative min-w-0 truncate">{row.label}</span>
        </li>
      ))}
    </ul>
  );
}

// Tiny columns for a stat tile, decoration next to the figure
export function Spark({
  values,
  color = 'bg-accent/60',
}: {
  values: { key: string; value: number }[];
  color?: string;
}) {
  const max = Math.max(1, ...values.map((v) => v.value));
  return (
    <div aria-hidden="true" className="flex h-5 items-end gap-px">
      {values.map((v) => (
        <span
          key={v.key}
          className={`flex-1 rounded-[1px] ${color}`}
          style={{ height: `${Math.max(8, (v.value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
