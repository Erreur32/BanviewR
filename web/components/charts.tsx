import { type ReactNode, useEffect, useRef, useState } from 'react';

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

type Part = { name: string; value: number; color: string };

// Hover detail of one column or one point: a line per series, then the total
function ChartTooltip({ left, title, parts }: { left: number; title: string; parts: Part[] }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-md border border-border bg-bg2 px-3 py-2 text-xs shadow-lg"
      style={{ left: `${left}%`, transform: `translateX(${left > 70 ? '-100%' : left < 30 ? '0' : '-50%'})` }}
    >
      <p className="mb-1 font-semibold">{title}</p>
      {parts
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
        <span className="font-mono font-semibold">{sum(parts.map((p) => p.value))}</span>
      </p>
    </div>
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
      {shown && <ChartTooltip left={left} title={shown.label} parts={shown.parts} />}
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

// One line per series over the same columns as StackedBars, crosshair and tooltip on hover or focus
export function LineChart({
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
  const names = [...new Map(columns.flatMap((c) => c.parts.map((p) => [p.name, p.color] as const))).entries()];
  const max = Math.max(1, ...columns.flatMap((c) => c.parts.map((p) => p.value)));
  const x = (i: number) => ((i + 0.5) / columns.length) * 100;
  const y = (value: number) => 100 - (value / max) * 98;
  const partValue = (column: BarColumn, name: string) => column.parts.find((p) => p.name === name)?.value ?? 0;
  const shown = active === null ? undefined : columns[active];

  return (
    <figure className="relative m-0">
      <figcaption className="sr-only">{label}</figcaption>
      <div className="relative border-border border-b" style={{ height }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={0}
              y2={100}
              className="stroke-border"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {names.map(([name, color]) => (
            <polyline
              key={name}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={columns.map((c, i) => `${x(i)},${y(partValue(c, name))}`).join(' ')}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex">
          {columns.map((column, i) => (
            <button
              type="button"
              key={column.key}
              aria-label={`${column.label}: ${sum(column.parts.map((p) => p.value))}`}
              className="h-full min-w-0 flex-1 cursor-default"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </div>
      </div>
      {axis}
      {shown && active !== null && <ChartTooltip left={x(active)} title={shown.label} parts={shown.parts} />}
    </figure>
  );
}

// Parts of a whole on one bar, surface gaps between them, names and shares below
export function ShareBar({ parts }: { parts: Part[] }) {
  const total = sum(parts.map((p) => p.value));
  const pct = (value: number) => (total ? Math.round((value / total) * 100) : 0);
  return (
    <div>
      <div className="flex h-6 gap-0.5 overflow-hidden rounded">
        {parts.map((part) => (
          <span
            key={part.name}
            title={`${part.name}: ${part.value}`}
            style={{ width: `${(part.value / Math.max(1, total)) * 100}%`, background: part.color }}
          />
        ))}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {parts.map((part) => (
          <li key={part.name} className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-muted">
              <Swatch color={part.color} />
              <span className="truncate">{part.name}</span>
            </span>
            <span className="font-mono">
              {part.value} <span className="text-muted">({pct(part.value)} %)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One hue, darkest for the fewest bans: on a dark surface magnitude reads as brightness
export const SEQ_RAMP = ['#0d419d', '#1158c7', '#1f6feb', '#58a6ff', '#a5d6ff'];
export const SEQ_EMPTY = '#21262d';
export const seqColor = (value: number, max: number) =>
  value <= 0
    ? SEQ_EMPTY
    : (SEQ_RAMP[Math.min(SEQ_RAMP.length - 1, Math.ceil((value / Math.max(1, max)) * SEQ_RAMP.length) - 1)] ??
      SEQ_EMPTY);

export type Cell = { key: string; label: string; value: number } | null;

// Rows of colored cells (week x hour, a year of days). The line above reads the hovered cell;
// the table format of each chart carries the same numbers for keyboard and screen readers.
export function CellGrid({
  rows,
  rowLabels,
  colLabels,
  describe,
  summary,
}: {
  rows: Cell[][];
  rowLabels: string[];
  colLabels?: ReactNode;
  describe: (cell: NonNullable<Cell>) => string;
  summary: string;
}) {
  const [hovered, setHovered] = useState<NonNullable<Cell> | null>(null);
  const max = Math.max(1, ...rows.flat().map((c) => c?.value ?? 0));
  const cols = Math.max(...rows.map((r) => r.length));
  // Wide grids open on their most recent end on small screens
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, []);
  return (
    <figure className="m-0">
      <p className="h-5 text-xs text-muted">{hovered ? describe(hovered) : summary}</p>
      <div ref={scroller} className="mt-1 overflow-x-auto">
        <div
          role="img"
          aria-label={summary}
          className="grid min-w-max gap-0.5"
          style={{ gridTemplateColumns: `2.5rem repeat(${cols}, minmax(10px, 1fr))` }}
          onMouseLeave={() => setHovered(null)}
        >
          {rows.map((row, r) => [
            <span
              key={`label-${rowLabels[r]}`}
              className="pr-1 text-right font-mono text-[10px] leading-[14px] text-muted"
            >
              {rowLabels[r]}
            </span>,
            ...row.map((cell, c) =>
              cell ? (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover detail only, the table format carries the data
                <span
                  key={cell.key}
                  className={`h-3.5 rounded-[2px] ${hovered?.key === cell.key ? 'outline outline-1 outline-text' : ''}`}
                  style={{ background: seqColor(cell.value, max) }}
                  onMouseEnter={() => setHovered(cell)}
                />
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: empty cells have no identity
                <span key={`empty-${r}-${c}`} />
              ),
            ),
          ])}
        </div>
        {colLabels}
      </div>
      <p className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted">
        <span>0</span>
        {SEQ_RAMP.map((color) => (
          <span key={color} className="size-2.5 rounded-[2px]" style={{ background: color }} />
        ))}
        <span>{max}</span>
      </p>
    </figure>
  );
}

// 24 hours around a dial, midnight on top, bar length for the bans of that hour
export function Clock({
  hours,
  describe,
  summary,
  size = 220,
}: {
  hours: number[];
  describe: (hour: number) => string;
  summary: string;
  size?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...hours);
  const [inner, outer] = [28, 48];
  const point = (hour: number, r: number) => {
    const angle = ((hour + 0.5) / 24) * 2 * Math.PI - Math.PI / 2;
    return [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)];
  };
  return (
    <figure className="m-0">
      <p className="h-5 text-xs text-muted">{hovered === null ? summary : describe(hovered)}</p>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="mx-auto mt-1 block"
        role="img"
        aria-label={summary}
        onMouseLeave={() => setHovered(null)}
      >
        <circle cx={50} cy={50} r={inner - 2} className="fill-none stroke-border" strokeWidth={0.5} />
        {hours.map((bans, hour) => {
          const [x1, y1] = point(hour, inner);
          const [x2, y2] = point(hour, inner + Math.max(0.8, (bans / max) * (outer - inner)));
          const [hx, hy] = point(hour, outer);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover detail only, the table format carries the data
            // biome-ignore lint/suspicious/noArrayIndexKey: the index is the hour
            <g key={hour} onMouseEnter={() => setHovered(hour)}>
              <line x1={x1} y1={y1} x2={hx} y2={hy} stroke="transparent" strokeWidth={8} />
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeWidth={4}
                strokeLinecap="round"
                className={hovered === hour ? 'stroke-text' : 'stroke-accent'}
              />
            </g>
          );
        })}
        {[0, 6, 12, 18].map((hour) => {
          const angle = (hour / 24) * 2 * Math.PI - Math.PI / 2;
          return (
            <text
              key={hour}
              x={50 + (inner - 7) * Math.cos(angle)}
              y={50 + (inner - 7) * Math.sin(angle) + 1.5}
              textAnchor="middle"
              className="fill-muted font-mono"
              fontSize={4.5}
            >
              {String(hour).padStart(2, '0')}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}
