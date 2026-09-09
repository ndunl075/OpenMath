import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { tryParseLatex } from "@openmath/math-core";
import { detectOutOfScope, normalizeLatex } from "@openmath/ocr";
import {
  CARET, deleteBackward, deleteForward, type Edit, insertAt, stepLeft, stepRight,
} from "../lib/latex-caret.js";
import { renderEditable, renderLatex } from "../lib/math-render.js";
import { Icon } from "./Icon.js";

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

/** Drawn faintly in the empty field, the way a text field shows what goes in it. */
const PLACEHOLDER = "2x+3=7";

const FIELD_ID = "problem";
const RAW_ID = "problem-latex";
const HINT_ID = "problem-hint";
const ERROR_ID = "problem-error";
const NOTE_ID = "problem-note";

/** Where the caret is drawn: the end of the selection that moves. */
function caretOf(el: HTMLInputElement): number {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  return el.selectionDirection === "backward" ? start : end;
}

function selectionOf(el: HTMLInputElement): [number, number] {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  return [Math.min(start, end), Math.max(start, end)];
}

/** Keeps a tap on a key or the field from taking focus away from the input. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The problem, edited as the maths it is.
 *
 * A full math editor is a large dependency for something most people use to
 * fix two characters after a scan, and it would not fit the first-load budget.
 * So the field is a shadow input: a real <input> holds the LaTeX and takes the
 * keystrokes, the IME and the phone keyboard, but it is invisible. What the
 * reader sees is KaTeX's rendering of it, with the caret drawn where their
 * next character lands. Arrows move through the structure and backspace takes
 * a fraction whole; the pure logic for that is in lib/latex-caret.
 *
 * The rendered line is the repaired form of the text, the same form the solver
 * gets, so that cos(0) is shown as cos of nought and not four letters
 * multiplied. The caret is carried through that repair as a marker character.
 */
export function MathInput({
  value, onChange, onSubmit, autoFocus, submitLabel = "Solve",
}: MathInputProps) {
  /** The shadow field: takes the keys, never seen. */
  const inputRef = useRef<HTMLInputElement>(null);
  /** The raw LaTeX line, folded away by default. */
  const rawRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [touched, setTouched] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [rawOpen, setRawOpen] = useState(false);
  /** Which field the keypad types into: the last one that had focus. */
  const target = useRef<"math" | "raw">("math");
  /** The last value this field produced, to tell its own edits from a scan arriving. */
  const emitted = useRef(value);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // A value that came from outside (a scan, a history entry) puts the caret at its end.
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setCaret(value.length);
    }
  }, [value]);

  // Native caret moves (Home, End, a shift-selection) reach the drawn caret this way.
  useEffect(() => {
    const onSelectionChange = () => {
      const el = document.activeElement;
      if (el === inputRef.current || el === rawRef.current) setCaret(caretOf(el as HTMLInputElement));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // The preview and the answer have to agree about what was typed, so both
  // read the repaired form: cos(0) previews as cos of nought, not as four
  // letters multiplied together.
  const repaired = normalizeLatex(value);
  const parsed = tryParseLatex(repaired);
  const scopeWarning = value.trim() ? detectOutOfScope(repaired) : null;
  // An argument the keypad left empty is drawn as an empty box, which says
  // what is missing better than the parser's "unexpected }" would.
  const awaitingArgument = /(?<!\\)\{\}/.test(value);
  const showError = touched && value.trim().length > 0 && !parsed.ok && !awaitingArgument;

  const at = Math.min(caret, value.length);
  const html = value.trim()
    ? renderEditable(normalizeLatex(value.slice(0, at) + CARET + value.slice(at)))
    : renderEditable(`${CARET}\\htmlId{om-placeholder}{${PLACEHOLDER}}`);

  // A wide problem scrolls inside the field; the caret stays in view.
  useLayoutEffect(() => {
    const view = viewRef.current;
    const mark = view?.querySelector<HTMLElement>("#om-caret");
    if (!view || !mark) return;
    const box = view.getBoundingClientRect();
    const bar = mark.getBoundingClientRect();
    const margin = 24;
    if (bar.right > box.right - margin) view.scrollLeft += bar.right - box.right + margin;
    else if (bar.left < box.left + margin) view.scrollLeft -= box.left - bar.left + margin;
  }, [html]);

  const field = (): HTMLInputElement | null =>
    (target.current === "raw" && rawOpen ? rawRef.current : null) ?? inputRef.current;

  /** Write an edit into a field so its own selection and the drawn caret agree. */
  const apply = (el: HTMLInputElement, edit: Edit) => {
    el.value = edit.value;
    el.setSelectionRange(edit.caret, edit.caret);
    emitted.current = edit.value;
    setCaret(edit.caret);
    setTouched(true);
    onChange(edit.value);
  };

  const insert = (key: Key) => {
    const el = field();
    if (!el) return;
    const [start, end] = selectionOf(el);
    apply(el, insertAt(value, start, end, key.insert, key.back));
    el.focus();
  };

  const backspace = () => {
    const el = field();
    if (!el) return;
    const [start, end] = selectionOf(el);
    const edit = start === end
      ? deleteBackward(value, start)
      : { value: value.slice(0, start) + value.slice(end), caret: start };
    if (edit) apply(el, edit);
    el.focus();
  };

  const tryExample = (latex: string) => {
    const el = inputRef.current;
    if (el) apply(el, { value: latex, caret: latex.length });
    else onChange(latex);
    target.current = "math";
    el?.focus();
  };

  /** A tap anywhere on the maths puts the caret at the end and brings the keyboard up. */
  const focusField = (e: MouseEvent) => {
    e.preventDefault();
    const el = inputRef.current;
    if (!el) return;
    target.current = "math";
    el.focus();
    el.setSelectionRange(value.length, value.length);
    setCaret(value.length);
  };

  const submit = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return false;
    e.preventDefault();
    if (parsed.ok) onSubmit(value);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (submit(e)) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const el = e.currentTarget as HTMLInputElement;
    const [start, end] = selectionOf(el);
    const left = e.key === "ArrowLeft";
    // A selection collapses to its edge, as it would in any field.
    const next = start !== end
      ? (left ? start : end)
      : (left ? stepLeft(el.value, start) : stepRight(el.value, start));
    el.setSelectionRange(next, next);
    setCaret(next);
  };

  // Deletion is taken here rather than on keydown: a phone keyboard reports
  // backspace only as this event.
  const onBeforeInput = (e: InputEvent) => {
    if (e.isComposing) return;
    const el = e.currentTarget as HTMLInputElement;
    const [start, end] = selectionOf(el);
    // A selection is deleted as the browser would delete it.
    if (start !== end) return;
    let edit: Edit | null;
    if (e.inputType === "deleteContentBackward") edit = deleteBackward(el.value, start);
    else if (e.inputType === "deleteContentForward") edit = deleteForward(el.value, start);
    else return;
    e.preventDefault();
    if (edit) apply(el, edit);
  };

  const onInput = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    setTouched(true);
    emitted.current = el.value;
    setCaret(caretOf(el));
    onChange(el.value);
  };

  const syncCaret = (e: Event) => setCaret(caretOf(e.currentTarget as HTMLInputElement));

  const toggleRaw = () => {
    const open = !rawOpen;
    setRawOpen(open);
    target.current = open ? "raw" : "math";
    requestAnimationFrame(() => (open ? rawRef.current : inputRef.current)?.focus());
  };

  const describedBy = [HINT_ID, showError ? ERROR_ID : null, scopeWarning ? NOTE_ID : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div class="math-input">
      <div class="math-input__stage">
        <div class="math-input__lead">
          <h1 class="t-display">Type a problem</h1>
          <p class="page-lede">
            Arithmetic through calculus, worked step by step on this device.
          </p>
          {value.trim() ? null : (
            <>
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

        <div class="math-field">
          <label class="eyebrow math-field__label" for={FIELD_ID}>Problem</label>
          <div class="math-field__box" onMouseDown={focusField}>
            <input
              id={FIELD_ID}
              ref={inputRef}
              class="math-field__input"
              type="text"
              value={value}
              inputMode="text"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              enterkeyhint="go"
              aria-describedby={describedBy}
              aria-invalid={showError ? "true" : undefined}
              onInput={onInput}
              onBeforeInput={onBeforeInput}
              onKeyDown={onKeyDown}
              onKeyUp={syncCaret}
              onFocus={(e) => {
                target.current = "math";
                syncCaret(e);
              }}
            />
            <div
              ref={viewRef}
              class="math-field__view math-scroll"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <button
              type="button"
              class="math-input__backspace"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={backspace}
              aria-label="Delete"
            >
              <Icon name="backspace" size={22} />
            </button>
          </div>
          <p id={HINT_ID} class="visually-hidden">
            Written in LaTeX. Left and right arrows move through the structure; Enter solves.
          </p>
        </div>

        {showError ? (
          <p id={ERROR_ID} class="math-input__error">
            <Icon name="alert" size={15} />
            {parsed.ok ? "" : parsed.error}
          </p>
        ) : null}
        {scopeWarning ? (
          <p id={NOTE_ID} class="math-input__note">
            <Icon name="info" size={15} />
            {scopeWarning} are not supported yet.
          </p>
        ) : null}

        <div class="math-input__raw">
          <button
            type="button"
            class="math-input__raw-toggle"
            aria-expanded={rawOpen}
            aria-controls={RAW_ID}
            onClick={toggleRaw}
          >
            <Icon name={rawOpen ? "chevronUp" : "chevronDown"} size={16} />
            LaTeX
          </button>
          <div class="math-input__field" hidden={!rawOpen}>
            <input
              id={RAW_ID}
              ref={rawRef}
              type="text"
              value={value}
              inputMode="text"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              enterkeyhint="go"
              aria-label="Problem, as LaTeX"
              aria-describedby={describedBy}
              aria-invalid={showError ? "true" : undefined}
              onInput={onInput}
              onKeyDown={submit}
              onKeyUp={syncCaret}
              onMouseUp={syncCaret}
              onFocus={(e) => {
                target.current = "raw";
                syncCaret(e);
              }}
            />
          </div>
        </div>
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
                  onMouseDown={keepFocus}
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
