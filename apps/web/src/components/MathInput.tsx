import { useEffect, useRef, useState } from "preact/hooks";
import { tryParseLatex } from "@openmath/math-core";
import { detectOutOfScope } from "@openmath/ocr";
import { Icon } from "./Icon.js";
import { MathView } from "./MathView.js";

export interface MathInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  autoFocus?: boolean;
  submitLabel?: string;
}

interface Key {
  label: string;
  insert: string;
  /** Cursor offset from the end of the inserted text. */
  back?: number;
  wide?: boolean;
}

const KEYS: Key[][] = [
  [
    { label: "7", insert: "7" }, { label: "8", insert: "8" }, { label: "9", insert: "9" },
    { label: "(", insert: "(" }, { label: ")", insert: ")" },
    { label: "x", insert: "x" }, { label: "y", insert: "y" },
  ],
  [
    { label: "4", insert: "4" }, { label: "5", insert: "5" }, { label: "6", insert: "6" },
    { label: "+", insert: "+" }, { label: "−", insert: "-" },
    { label: "xⁿ", insert: "^{}", back: 1 }, { label: "√", insert: "\\sqrt{}", back: 1 },
  ],
  [
    { label: "1", insert: "1" }, { label: "2", insert: "2" }, { label: "3", insert: "3" },
    { label: "×", insert: "\\cdot " }, { label: "÷", insert: "\\div " },
    { label: "a⁄b", insert: "\\frac{}{}", back: 3 }, { label: "=", insert: "=" },
  ],
  [
    { label: "0", insert: "0" }, { label: ".", insert: "." },
    { label: "<", insert: "<" }, { label: ">", insert: ">" },
    { label: "≤", insert: "\\le " }, { label: "≥", insert: "\\ge " },
    { label: "|x|", insert: "||", back: 1 },
  ],
];

/**
 * LaTeX entry with a live preview and a compact math keypad.
 *
 * A full math editor is a large dependency for something most people use to fix
 * two characters after a scan. A plain field plus a preview does the job and
 * keeps the bundle small.
 */
export function MathInput({
  value, onChange, onSubmit, autoFocus, submitLabel = "Solve",
}: MathInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const parsed = tryParseLatex(value);
  const scopeWarning = value.trim() ? detectOutOfScope(value) : null;
  const showError = touched && value.trim().length > 0 && !parsed.ok;

  const insert = (key: Key) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + key.insert + value.slice(end);
    onChange(next);
    const caret = start + key.insert.length - (key.back ?? 0);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  };

  const backspace = () => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    if (start === end && start === 0) return;
    const from = start === end ? start - 1 : start;
    const next = value.slice(0, from) + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(from, from);
    });
  };

  return (
    <div class="math-input">
      <div class="math-input__preview" aria-live="polite">
        {value.trim() ? (
          <MathView latex={value} display label={`Preview of ${value}`} />
        ) : (
          <span class="math-input__placeholder">Type a problem, for example 2x + 3 = 7</span>
        )}
      </div>

      <div class="math-input__field">
        <input
          ref={inputRef}
          type="text"
          value={value}
          inputMode="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          aria-label="Problem in LaTeX"
          placeholder="2x + 3 = 7"
          onInput={(e) => {
            setTouched(true);
            onChange((e.target as HTMLInputElement).value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && parsed.ok) onSubmit(value);
          }}
        />
        <button
          type="button"
          class="math-input__backspace"
          onClick={backspace}
          aria-label="Delete"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      {showError ? (
        <p class="math-input__error">
          <Icon name="alert" size={15} />
          {parsed.ok ? "" : parsed.error}
        </p>
      ) : null}
      {scopeWarning ? (
        <p class="math-input__note">
          <Icon name="info" size={15} />
          {scopeWarning} are not supported yet.
        </p>
      ) : null}

      <div class="keypad" role="group" aria-label="Math keypad">
        {KEYS.map((row, i) => (
          <div class="keypad__row" key={i}>
            {row.map((key) => (
              <button
                type="button"
                key={key.label}
                class="keypad__key"
                onClick={() => insert(key)}
              >
                {key.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <button
        type="button"
        class="button button--primary button--block"
        disabled={!value.trim() || !parsed.ok}
        onClick={() => onSubmit(value)}
      >
        {submitLabel}
      </button>
    </div>
  );
}
