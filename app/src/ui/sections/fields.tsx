import { useRef, useState } from 'react';
import { fmtTime, parseTime } from '../../model/schedule';

/**
 * Labeled free-text TIME input that normalizes on blur (PRD #179). While you
 * type it stays exactly what you typed; when you leave the field, a parseable
 * value is rewritten to its canonical form ("1:00 PM") so you see how it was
 * read — the defense against a silent AM/PM flip. Unparseable text (e.g.
 * "lunchtime") is left untouched. The parsing itself is the tested pure model
 * function; this component is the thin UI over it.
 */
export function TimeField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const normalize = () => {
    const mins = parseTime(value);
    if (mins == null) return; // leave unparseable / empty text as the user wrote it
    const canonical = fmtTime(mins);
    if (canonical && canonical !== value) onChange(canonical);
  };
  return (
    <label className="field">
      {label}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={normalize}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Labeled input — the one field pattern every section uses. */
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  placeholder,
  hint,
  wide,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: 'text' | 'email' | 'tel' | 'date' | 'password';
  inputMode?: 'text' | 'numeric' | 'tel' | 'decimal';
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className={wide ? 'field field-wide' : 'field'}>
      {label}
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Labeled multi-line textarea — the optional free-text bios (PRD #68) and similar. */
export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  wide,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  rows?: number;
}) {
  return (
    <label className={wide ? 'field field-wide' : 'field'}>
      {label}
      <textarea
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Labeled select over a fixed option list. */
export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
  optionLabel,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  hint?: string;
  optionLabel?: (option: T) => string;
}) {
  const byString = new Map(options.map((o) => [String(o), o]));
  return (
    <label className="field">
      {label}
      <select value={String(value)} onChange={(e) => onChange(byString.get(e.target.value) as T)}>
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {optionLabel ? optionLabel(o) : String(o)}
          </option>
        ))}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** v12-style subsection divider ("Dates & Times", "Fees & Deadlines", …). */
export function Divider({ children }: { children: string }) {
  return <div className="section-divider">{children}</div>;
}

/** Copy-to-clipboard button that flashes "✓ Copied!" for 2 s (v12 pattern). */
export function CopyButton({ getText, label = 'Copy' }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  async function copy() {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (e.g. non-secure context) — nothing to flash.
    }
  }

  return (
    <button type="button" className="btn-util" onClick={() => void copy()}>
      {copied ? '✓ Copied!' : label}
    </button>
  );
}
