import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useEffect, useId, useState } from 'react';

export function Card({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-bg1 p-5">
      {title && <h2 className="mb-4 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

const BUTTON_VARIANTS = {
  primary: 'border-ok/40 bg-ok/15 hover:bg-ok/25',
  secondary: 'border-border bg-bg2 hover:bg-border',
  danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: 'md' | 'sm';
};

export function Button({ className = '', variant = 'primary', size = 'md', ...props }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm';
  return (
    <button
      type="button"
      className={`rounded-md border font-medium text-text disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

// Destructive action in two clicks: the first one arms the button for a few seconds
export function ConfirmButton({
  confirmLabel,
  onConfirm,
  children,
  ...props
}: Omit<ButtonProps, 'onClick'> & { confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      variant="danger"
      {...props}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}

const BADGE_TONES = {
  neutral: 'border-border text-muted',
  ok: 'border-ok/50 text-ok',
  danger: 'border-danger/50 text-danger',
  accent: 'border-accent/50 text-accent',
};

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

// A few exclusive choices side by side: display mode, chart format
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="inline-flex gap-0.5 rounded-lg border border-border bg-bg1 p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1.5 text-xs ${option.value === value ? 'bg-bg2 font-semibold text-text' : 'text-muted hover:text-text'}`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

// Horizontal scroll on small screens, header cells from `columns`
export function Table({ columns, children }: { columns: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg1 text-xs text-muted">
          <tr>
            {columns.map((col, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static header list
              <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&_td]:px-3 [&_td]:py-2">{children}</tbody>
      </table>
    </div>
  );
}

export function CheckboxField({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="accent-accent" {...props} />
      {label}
    </label>
  );
}

const fieldClass =
  'w-full rounded-md border border-border bg-bg0 px-3 py-2 text-sm text-text outline-none focus:border-accent';

type FieldProps = { label: string; hint?: string };

export function TextField({ label, hint, ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      <input id={id} className={fieldClass} {...props} />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      <select id={id} className={fieldClass} {...props}>
        {children}
      </select>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}

const LOGO_CELLS = [4, 24, 44];

// One banned cell among the others, same drawing as public/favicon.svg
export function Logo({ size, className = '' }: { size: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="BanviewR"
      className={`inline-flex items-center gap-2 font-mono font-semibold ${className}`}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        {LOGO_CELLS.flatMap((y) =>
          LOGO_CELLS.map((x) => (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="16"
              height="16"
              rx="3"
              className={x === 44 && y === 4 ? 'fill-danger' : 'fill-muted'}
            />
          )),
        )}
      </svg>
      <span>
        <span className="text-muted">[</span>ban<span className="text-danger">view</span>r
        <span className="text-muted">]</span>
      </span>
    </span>
  );
}

// Centered single-card page for setup and sign-in
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center">
          <Logo size={30} className="text-2xl" />
        </p>
        <Card title={title}>{children}</Card>
      </div>
    </main>
  );
}
