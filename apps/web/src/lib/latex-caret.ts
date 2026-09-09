/**
 * Caret motion and deletion over a LaTeX string, for the maths field.
 *
 * What the reader sees is KaTeX's rendering; what sits underneath is LaTeX. A
 * caret that moved one character at a time through that string would stop in
 * places that mean nothing on screen (between the backslash and the f of
 * \frac), and a backspace that took one character would leave a fraction one
 * brace short. So the caret moves between the things that are drawn, steps
 * into and out of brace groups, and deletes drawn things whole.
 *
 * Nothing here knows about the DOM. Positions are plain string indices, which
 * is what an <input>'s selection reports and what the keypad inserts at.
 */

/**
 * Marks the caret while the string goes through normalisation. A private-use
 * character: no normalisation pass recognises it, so every pass leaves it where
 * it stands and the caret comes out exactly where the reader put it, even when
 * the text around it was rewritten (a typed cos becoming \cos).
 */
export const CARET = "\uE000";

const LETTER = /[a-zA-Z]/;

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && LETTER.test(ch);
}

function isScript(ch: string | undefined): boolean {
  return ch === "^" || ch === "_";
}

/** Index of the `}` matching the `{` at `open`, or -1 when unbalanced. */
export function closeOf(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the `{` matching the `}` at `close`, or -1 when unbalanced. */
export function openOf(s: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (s[i - 1] === "\\") {
      i--;
      continue;
    }
    const c = s[i];
    if (c === "}") depth++;
    else if (c === "{") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Start of the control word ending at `end` (the backslash of \frac), or -1. */
function commandStart(s: string, end: number): number {
  let i = end;
  while (i > 0 && isLetter(s[i - 1])) i--;
  if (i < end && i > 0 && s[i - 1] === "\\") return i - 1;
  return -1;
}

/** Index just past the name of the control sequence whose backslash is at `start`. */
function commandEnd(s: string, start: number): number {
  let i = start + 1;
  if (!isLetter(s[i])) return Math.min(i + 1, s.length);
  while (i < s.length && isLetter(s[i])) i++;
  return i;
}

function optionalEnd(s: string, open: number): number {
  const close = s.indexOf("]", open);
  return close < 0 ? s.length : close + 1;
}

function groupEnd(s: string, open: number): number {
  const close = closeOf(s, open);
  return close < 0 ? s.length : close + 1;
}

/**
 * End of the drawn unit that starts at `p`: a command with the arguments it
 * takes, a brace group, a script with its argument, or one character.
 */
export function unitEnd(s: string, p: number): number {
  const c = s[p];
  if (c === undefined) return p;
  if (c === "\\") {
    let i = commandEnd(s, p);
    const name = s.slice(p + 1, i);
    // \left( and \right| take the delimiter that follows.
    if (name === "left" || name === "right") return unitEnd(s, i);
    if (s[i] === "[") i = optionalEnd(s, i);
    const before = i;
    while (s[i] === "{") i = groupEnd(s, i);
    // A space after a bare control word is what ends its name; it belongs to it.
    if (i === before && s[i] === " ") i++;
    return i;
  }
  if (c === "{") return groupEnd(s, p);
  if (isScript(c)) {
    const next = s[p + 1];
    if (next === "{") return groupEnd(s, p + 1);
    if (next === "\\") return unitEnd(s, p + 1);
    return Math.min(p + 2, s.length);
  }
  return p + 1;
}

/**
 * Start of the drawn unit that ends at `p`, or -1 when `p` sits just inside an
 * opening brace, where nothing drawn ends.
 */
export function unitStart(s: string, p: number): number {
  if (p <= 0) return -1;
  const c = s[p - 1]!;
  if (c === "{") return -1;
  if (c === "}" && s[p - 2] !== "\\") {
    const open = openOf(s, p - 1);
    if (open < 0) return p - 1;
    return argumentsStart(s, open, true);
  }
  let start = p - 1;
  if (s[p - 2] === "\\" && !isLetter(c)) {
    // A control symbol such as \{ or \, is its backslash and one character.
    start = p - 2;
  } else if (isLetter(c)) {
    const cmd = commandStart(s, p);
    if (cmd >= 0) start = cmd;
  } else if (c === " ") {
    const cmd = commandStart(s, p - 1);
    if (cmd >= 0) start = cmd;
  }
  return withOwner(s, start);
}

/**
 * Widen the start of a unit to what it belongs with: a delimiter to the \left
 * or \right in front of it, and an exponent to its ^, so that x^2 loses ^2 in
 * one go.
 */
function withOwner(s: string, start: number): number {
  const owner = commandStart(s, start);
  if (owner >= 0 && isFence(s.slice(owner + 1, start))) start = owner;
  if (isScript(s[start - 1])) start -= 1;
  return start;
}

function isFence(name: string): boolean {
  return name === "left" || name === "right";
}

/**
 * Given the `{` of an argument group, the start of the whole construct that
 * owns it: the command with every argument before this one, or the script
 * mark, or, for a bare group, the group itself. With `wholeCommand` false the
 * scan stops at the first argument and reports where the arguments begin.
 */
function argumentsStart(s: string, open: number, wholeCommand: boolean): number {
  let i = open;
  for (;;) {
    if (s[i - 1] === "}") {
      const o = openOf(s, i - 1);
      if (o < 0) break;
      i = o;
    } else if (s[i - 1] === "]") {
      const o = s.lastIndexOf("[", i - 1);
      if (o < 0) break;
      i = o;
    } else break;
  }
  if (!wholeCommand) return i;
  const cmd = commandStart(s, i);
  if (cmd >= 0) return cmd;
  if (isScript(s[i - 1])) return i - 1;
  return i;
}

/** The construct that owns the group opening at `open`, and whether it holds anything. */
function structureAround(s: string, open: number): { start: number; end: number; empty: boolean } {
  const start = argumentsStart(s, open, true);
  let i = argumentsStart(s, open, false);
  let empty = true;
  while (s[i] === "[" || s[i] === "{") {
    const end = s[i] === "[" ? optionalEnd(s, i) : groupEnd(s, i);
    if (s.slice(i + 1, end - 1).trim()) empty = false;
    i = end;
  }
  return { start, end: i, empty };
}

/** The next place the caret can rest to the right of `p`, into groups rather than over them. */
export function stepRight(s: string, p: number): number {
  if (p >= s.length) return s.length;
  const c = s[p]!;
  if (c === "}" || c === "]") {
    // Out of this argument and straight into the next one, if there is one.
    const q = p + 1;
    return s[q] === "{" ? q + 1 : q;
  }
  if (c === "{") return p + 1;
  if (c === "\\") {
    const end = commandEnd(s, p);
    const name = s.slice(p + 1, end);
    if (name === "left" || name === "right") return unitEnd(s, p);
    // Into the first argument; or past the space that ends a bare name.
    if (s[end] === "{" || s[end] === "[" || s[end] === " ") return end + 1;
    return end;
  }
  if (isScript(c)) {
    if (s[p + 1] === "{") return p + 2;
    return unitEnd(s, p);
  }
  return p + 1;
}

/** The next place the caret can rest to the left of `p`. */
export function stepLeft(s: string, p: number): number {
  if (p <= 0) return 0;
  const c = s[p - 1]!;
  if (s[p - 2] === "\\" && !isLetter(c)) return p - 2;
  if (c === "{" || c === "[") {
    // Out of this argument backwards: into the one before it, or in front of
    // whatever owns it.
    const q = p - 1;
    if (s[q - 1] === "}" || s[q - 1] === "]") return q - 1;
    const cmd = commandStart(s, q);
    if (cmd >= 0) return cmd;
    if (isScript(s[q - 1])) return q - 1;
    return q;
  }
  if (c === "}" || c === "]") return p - 1;
  let q = p - 1;
  if (isLetter(c)) {
    const cmd = commandStart(s, p);
    if (cmd >= 0) q = cmd;
  } else if (c === " ") {
    const cmd = commandStart(s, p - 1);
    if (cmd >= 0) q = cmd;
  }
  return withOwner(s, q);
}

export interface Edit {
  value: string;
  caret: number;
}

/**
 * Backspace. Takes the drawn unit before the caret whole. Just inside an
 * opening brace there is nothing drawn to take: an empty construct (a fraction
 * the keypad just put in) is undone, and a construct with content is stepped
 * out of instead, so nothing is deleted from inside it unseen.
 */
export function deleteBackward(s: string, p: number): Edit | null {
  if (p <= 0) return null;
  const start = unitStart(s, p);
  if (start >= 0) return { value: s.slice(0, start) + s.slice(p), caret: start };
  const structure = structureAround(s, p - 1);
  if (structure.empty) {
    return { value: s.slice(0, structure.start) + s.slice(structure.end), caret: structure.start };
  }
  return { value: s, caret: stepLeft(s, p) };
}

/** Forward delete, the mirror of backspace. */
export function deleteForward(s: string, p: number): Edit | null {
  if (p >= s.length) return null;
  const c = s[p];
  if (c === "}" || c === "]") return { value: s, caret: stepRight(s, p) };
  const end = unitEnd(s, p);
  return { value: s.slice(0, p) + s.slice(end), caret: p };
}

/**
 * Insert `text` over the selection [start, end), leaving the caret `back`
 * characters short of the end of what was inserted (inside the braces of
 * `\frac{}{}`). A letter typed straight after a control word is separated from
 * it, so that x after \sin gives \sin x and not \sinx.
 */
export function insertAt(s: string, start: number, end: number, text: string, back = 0): Edit {
  const insert = isLetter(text[0]) && commandStart(s, start) >= 0 ? ` ${text}` : text;
  return {
    value: s.slice(0, start) + insert + s.slice(end),
    caret: start + insert.length - back,
  };
}

const CARET_MARKUP = "\\htmlId{om-caret}{{}}";

/**
 * Turn a normalised string that still carries the caret marker into what KaTeX
 * draws: the marker becomes a zero-width group with an id the stylesheet turns
 * into a bar, and every empty argument becomes a faint square, so a fraction
 * with nothing in it yet is still a fraction on screen. An empty group inside
 * braces keeps the {} that KaTeX needs to see an ordinary atom there, which is
 * what keeps the spacing around + and = the same with the caret as without.
 */
export function decorateForDisplay(s: string): string {
  let slots = 0;
  const slot = () => `\\htmlId{om-slot-${++slots}}{\\square}`;
  // The caret's own markup holds a {} of its own, so it goes in last.
  return s
    .replace(new RegExp(`\\{${CARET}\\}`, "g"), () => `{${CARET}${slot()}}`)
    .replace(/(?<!\\)\{\}/g, () => `{${slot()}}`)
    .split(CARET).join(CARET_MARKUP);
}
