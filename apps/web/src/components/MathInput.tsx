import { useEffect, useRef, useState } from "preact/hooks";
import { tryParseLatex } from "@openmath/math-core";
import { detectOutOfScope, normalizeLatex } from "@openmath/ocr";
import { renderLatex } from "../lib/math-render.js";
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
  /** Operators and symbols get a darker key than digits, as on any calculator. */
  op?: boolean;
}

const KEYS: Key[][] = [
  [
    { label: "7", insert: "7" }, { label: "8", insert: "8" }, { label: "9", insert: "9" },
    { label: "(", insert: "(", op: true }, { label: ")", insert: ")", op: true },
    { label: "x", insert: "x", op: true }, { label: "y", insert: "y", op: true },
  ],
  [
    { label: "4", insert: "4" }, { label: "5", insert: "5" }, { label: "6", insert: "6" },
    { label: "+", insert: "+", op: true }, { label: "−", insert: "-", op: true },
    { label: "xⁿ", insert: "^{}", back: 1, op: true }, { label: "√", insert: "\\sqrt{}", back: 1, op: true },
  ],
  [
    { label: "1", insert: "1" }, { label: "2", insert: "2" }, { label: "3", insert: "3" },
    { label: "×", insert: "\\cdot ", op: true }, { label: "÷", insert: "\\div ", op: true },
    { label: "a⁄b", insert: "\\frac{}{}", back: 3, op: true }, { label: "=", insert: "=", op: true },
  ],
  [
    { label: "0", insert: "0" }, { label: ".", insert: "." },
    { label: "<", insert: "<", op: true }, { label: ">", insert: ">", op: true },
    { label: "≤", insert: "\\le ", op: true }, { label: "≥", insert: "\\ge ", op: true },
    { label: "|x|", insert: "||", back: 1, op: true },
  ],
];

/** Shown while the field is empty; one tap fills it in. Each is something the engine solves. */
const EXAMPLES = ["2x+3=7", "x^{2}-5x+6=0", "\\frac{1}{2}+\\frac{1}{3}", "\\frac{d}{dx}\\sin(2x)"];

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

  // The preview and the answer have to agree about what was typed, so both
  // read the repaired form: cos(0) previews as cos of nought, not as four
  // letters multiplied together.
  const repaired = normalizeLatex(value);
  const parsed = tryParseLatex(repaired);
  const scopeWarning = value.trim() ? detectOutOfScope(repaired) : null;
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

  const tryExample = (latex: string) => {
    onChange(latex);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      input?.setSelectionRange(latex.length, latex.length);
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
      <div class="math-input__stage">
        {/* The lead is the screen's headline: the heading and a few problems
            to try while the field is empty, and the typed problem itself,
            set large, once there is one. */}
        <div class={`math-input__lead${value.trim() ? " math-input__lead--preview" : ""}`} aria-live="polite">
          {value.trim() ? (
            <>
              <h1 class="visually-hidden">Type a problem</h1>
              <span class="eyebrow">Preview</span>
              <MathView
                latex={repaired}
                display
                label={`Preview of ${value}`}
                class="math-input__preview"
              />
            </>
          ) : (
            <>
              <h1 class="t-display">Type a problem</h1>
              <p class="page-lede">
                Arithmetic through calculus, worked step by step on this device.
              </p>
              <span class="eyebrow math-input__examples-label">Or start from one of these</span>
              <ul class="examples">
                {EXAMPLES.map((latex) => (
                  <li key={latex}>
                    <button
                      type="button"
                      class="examples__item"
                      onClick={() => tryExample(latex)}
                      aria-label={`Try ${latex}`}
                    >
                      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderLatex(latex) }} />
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div class="math-input__field">
          <span class="math-input__field-label" aria-hidden="true">LaTeX</span>
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
            <Icon name="backspace" size={22} />
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
      </div>

      <div class="math-input__tray">
        <div class="keypad" role="group" aria-label="Math keypad">
          {KEYS.map((row, i) => (
            <div class="keypad__row" key={i}>
              {row.map((key) => (
                <button
                  type="button"
                  key={key.label}
                  class={`keypad__key ${key.op ? "keypad__key--op" : ""}`}
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
          class="button button--primary button--block button--tall math-input__solve"
          disabled={!value.trim() || !parsed.ok}
          onClick={() => onSubmit(value)}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
