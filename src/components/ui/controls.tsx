"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "default" | "primary" | "dark" | "ghost" | "danger" | "danger-ghost";

export function Button({
  variant = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type="button" className={`btn btn-${variant}${className ? ` ${className}` : ""}`} {...props} />;
}

export type TooltipSide = "top" | "bottom" | "left" | "right";

/**
 * Icon-first button. The label is the accessible name and the tooltip
 * (with the shortcut, if any). `active` makes it a toggle (aria-pressed).
 */
export function IconButton({
  label,
  shortcut,
  active,
  tooltip,
  tooltipSide = "bottom",
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  shortcut?: string;
  active?: boolean;
  /** Overrides the tooltip text (defaults to the label). */
  tooltip?: string;
  tooltipSide?: TooltipSide;
  children: ReactNode;
}) {
  const text = tooltip ?? label;
  return (
    <button
      type="button"
      className={`icon-btn${active ? " is-active" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={shortcut ? `${text}  ${shortcut}` : text}
      data-tooltip-side={tooltipSide}
      {...props}
    >
      {children}
    </button>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  /** Return false (or an error message) to reject and revert. */
  onCommit: (value: number) => boolean | string;
  unit?: string;
  decimals?: number;
  /** Display multiplier: 1000 shows metres as millimetres. Values are always committed in metres. */
  scale?: number;
  disabled?: boolean;
  hint?: string;
  testId?: string;
  compact?: boolean;
}

/**
 * Numeric input that commits on Enter or blur and reverts on Escape.
 * Editing does not touch the document until committed.
 */
export function NumberField({ label, value, onCommit, unit = "m", decimals = 3, scale = 1, disabled, hint, testId, compact }: NumberFieldProps) {
  const id = useId();
  const format = (v: number) => (Number.isFinite(v) ? (v * scale).toFixed(decimals) : "");
  const [text, setText] = useState(format(value));
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setText(format(value));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals, scale]);

  const commit = () => {
    editing.current = false;
    const parsed = Number(text.replace(",", ".").trim()) / scale;
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      setError("Enter a number");
      setText(format(value));
      return;
    }
    if (Math.abs(parsed - value) < 5e-7 || (scale !== 1 && (parsed * scale).toFixed(decimals) === format(value))) {
      setText(format(value));
      setError(null);
      return;
    }
    const result = onCommit(parsed);
    if (result === true) setError(null);
    else {
      setError(typeof result === "string" ? result : null);
      setText(format(value));
    }
  };

  return (
    <div className={compact ? "field field-compact" : "field"}>
      <label htmlFor={id}>{label}</label>
      <div className={`input-with-unit${error ? " has-error" : ""}`}>
        <input
          id={id}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          data-testid={testId}
          aria-invalid={!!error}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
          onFocus={(e) => {
            editing.current = true;
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              editing.current = false;
              setText(format(value));
              setError(null);
              e.currentTarget.blur();
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {(error || hint) && (
        <p id={`${id}-hint`} className={error ? "field-error" : "field-hint"}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/**
 * Numeric input whose value may be absent: clearing the field commits null.
 * Commits on Enter or blur and reverts on Escape, like NumberField.
 */
export function OptionalNumberField({
  label,
  value,
  onCommit,
  unit,
  decimals = 1,
  placeholder = "Optional",
  testId,
}: {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => boolean | string;
  unit?: string;
  decimals?: number;
  placeholder?: string;
  testId?: string;
}) {
  const id = useId();
  const format = (v: number | null) => (v === null ? "" : String(Number(v.toFixed(decimals))));
  const [text, setText] = useState(format(value));
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setText(format(value));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);

  const commit = () => {
    editing.current = false;
    const trimmed = text.replace(",", ".").trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && !Number.isFinite(parsed)) {
      setError("Enter a number, or leave empty");
      setText(format(value));
      return;
    }
    if (parsed === value || (parsed !== null && value !== null && Math.abs(parsed - value) < 1e-9)) {
      setText(format(value));
      setError(null);
      return;
    }
    const result = onCommit(parsed);
    if (result === true) setError(null);
    else {
      setError(typeof result === "string" ? result : null);
      setText(format(value));
    }
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`input-with-unit${error ? " has-error" : ""}`}>
        <input
          id={id}
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          data-testid={testId}
          aria-invalid={!!error}
          onFocus={(e) => {
            editing.current = true;
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              editing.current = false;
              setText(format(value));
              setError(null);
              e.currentTarget.blur();
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onCommit: (value: string) => boolean | string;
  maxLength?: number;
  autoFocusKey?: string | number | null;
  testId?: string;
}

export function TextField({ label, value, onCommit, maxLength = 80, autoFocusKey, testId }: TextFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);

  useEffect(() => {
    if (autoFocusKey !== undefined && autoFocusKey !== null) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [autoFocusKey]);

  const commit = () => {
    editing.current = false;
    if (text === value) return;
    const result = onCommit(text);
    if (result === true) setError(null);
    else {
      setError(typeof result === "string" ? result : null);
      setText(value);
    }
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={ref}
        className={error ? "has-error" : undefined}
        value={text}
        maxLength={maxLength}
        data-testid={testId}
        aria-invalid={!!error}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            editing.current = false;
            setText(value);
            e.currentTarget.blur();
          }
        }}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} data-testid={testId} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <span id={id} className="field-label">
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? "is-active" : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReadoutRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="readout">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

/**
 * Disclosure menu built on <details>: keyboard and screen-reader friendly,
 * closes on outside pointer down, Escape, or when an item is picked.
 */
export function Menu({
  label,
  summary,
  align = "left",
  testId,
  className,
  children,
}: {
  label: string;
  summary: ReactNode;
  align?: "left" | "right";
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details className={`menu${className ? ` ${className}` : ""}`} ref={ref}>
      <summary aria-label={label} data-testid={testId}>
        {summary}
      </summary>
      <div className={`menu-panel menu-${align}`} role="menu">
        {children}
      </div>
    </details>
  );
}

/** A menu entry; picking it closes the enclosing Menu. */
export function MenuItem({ onSelect, children, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> & { onSelect: () => void }) {
  return (
    <button
      role="menuitem"
      type="button"
      {...props}
      onClick={(e) => {
        e.currentTarget.closest("details")?.removeAttribute("open");
        onSelect();
      }}
    >
      {children}
    </button>
  );
}
