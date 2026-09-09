/**
 * Clean up what an OCR model emits so the parser has a fair chance.
 *
 * Models trained on rendered LaTeX produce display markup (math delimiters,
 * spacing commands, \left and \right) and photos contribute Unicode symbols
 * that never appear in LaTeX source. None of it is meaningful to the solver, so
 * it is stripped here rather than complicating the grammar.
 */

export interface NormalizeReport {
  latex: string;
  /** What was changed, for the report-a-bad-scan flow. */
  notes: string[];
  /**
   * The variable an instruction asked for, as in "solve for y". Undefined when
   * the input carried no such instruction.
   */
  solveFor?: string;
}

const UNICODE: Array<[RegExp, string]> = [
  [/[×✕✖]/g, "\\times "],
  [/[÷]/g, "\\div "],
  [/[·•∙⋅]/g, "\\cdot "],
  [/[−–—―]/g, "-"],
  [/[⁄∕]/g, "/"],
  [/√/g, "\\sqrt"],
  [/∛/g, "\\sqrt[3]"],
  [/≤/g, "\\le "],
  [/≥/g, "\\ge "],
  [/≠/g, "\\neq "],
  [/±/g, "\\pm "],
  [/∞/g, "\\infty "],
  [/[→⟶⇒]/g, "\\to "],
  [/[‘’ʼ]/g, "'"],
  [/[“”]/g, '"'],
  [/ /g, " "],
];

const GREEK: Record<string, string> = {
  "α": "\\alpha ", "β": "\\beta ", "γ": "\\gamma ", "δ": "\\delta ",
  "ε": "\\epsilon ", "θ": "\\theta ", "λ": "\\lambda ", "μ": "\\mu ",
  "π": "\\pi ", "ρ": "\\rho ", "σ": "\\sigma ", "τ": "\\tau ",
  "φ": "\\phi ", "ω": "\\omega ",
};

const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-",
};

const VULGAR: Record<string, string> = {
  "½": "\\frac{1}{2}", "⅓": "\\frac{1}{3}", "⅔": "\\frac{2}{3}",
  "¼": "\\frac{1}{4}", "¾": "\\frac{3}{4}", "⅕": "\\frac{1}{5}",
  "⅙": "\\frac{1}{6}", "⅛": "\\frac{1}{8}",
};

/** Layout-only commands that carry no mathematical meaning. */
const NOISE_COMMANDS = [
  "displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle",
  "limits", "nolimits", "thinspace", "medspace", "thickspace",
  "negthinspace", "quad", "qquad", "bigl", "bigr", "Bigl", "Bigr",
  "biggl", "biggr", "Biggl", "Biggr", "big", "Big", "bigg", "Bigg",
];

/** Wrappers whose content is the actual expression. */
const TRANSPARENT_WRAPPERS = [
  "mathrm", "mathit", "mathbf", "mathsf", "mathtt", "mathnormal",
  "operatorname", "text", "textrm", "textit", "mbox", "boldsymbol",
];

function stripDelimiters(s: string, notes: string[]): string {
  let out = s.trim();
  const before = out;
  out = out.replace(/^\$\$?/, "").replace(/\$\$?$/, "");
  out = out.replace(/^\\\(/, "").replace(/\\\)$/, "");
  out = out.replace(/^\\\[/, "").replace(/\\\]$/, "");
  if (out !== before) notes.push("removed math delimiters");
  return out.trim();
}

function replaceUnicode(s: string, notes: string[]): string {
  let out = s;
  const before = out;
  for (const [re, rep] of UNICODE) out = out.replace(re, rep);
  for (const [ch, rep] of Object.entries(GREEK)) out = out.split(ch).join(rep);
  for (const [ch, rep] of Object.entries(VULGAR)) out = out.split(ch).join(rep);

  // Runs of superscript characters become a single exponent group.
  out = out.replace(/[⁰¹²³⁴-⁹⁺⁻]+/g, (run) => {
    const digits = [...run].map((c) => SUPERSCRIPTS[c] ?? "").join("");
    return digits ? `^{${digits}}` : "";
  });

  if (out !== before) notes.push("converted Unicode symbols to LaTeX");
  return out;
}

function stripNoise(s: string, notes: string[]): string {
  let out = s;
  const before = out;
  for (const cmd of NOISE_COMMANDS) {
    out = out.replace(new RegExp(`\\\\${cmd}(?![a-zA-Z])`, "g"), " ");
  }
  // Spacing macros: \, \; \! \: \ and a literal tilde.
  out = out.replace(/\\[,;!:>]/g, " ");
  out = out.replace(/\\ /g, " ");
  out = out.replace(/~/g, " ");
  // \left( and \right) become plain brackets; the serializer re-adds them.
  out = out.replace(/\\left\s*\./g, "");
  out = out.replace(/\\right\s*\./g, "");
  out = out.replace(/\\left(?![a-zA-Z])/g, "");
  out = out.replace(/\\right(?![a-zA-Z])/g, "");
  if (out !== before) notes.push("removed layout commands");
  return out;
}

/** Read one balanced {...} group starting at `start`, or null when unbalanced. */
function readGroup(s: string, start: number): { body: string; end: number } | null {
  if (s[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{" && s[i - 1] !== "\\") depth++;
    else if (s[i] === "}" && s[i - 1] !== "\\") {
      depth--;
      if (depth === 0) return { body: s.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/*
 * Environments that only carry layout. A recognition model given a photo of a
 * single line very often returns it wrapped in one of these — `\\begin{aligned}
 * y = 6x + 2 \\end{aligned}` is `y = 6x + 2` with decoration — so refusing them
 * outright refused most real scans. Matrix environments are deliberately absent:
 * those carry meaning the solver has no rules for, and stay out of scope.
 */
const LAYOUT_ENVIRONMENTS = [
  "aligned", "align", "alignat", "gathered", "gather", "split",
  "equation", "displaymath", "math", "array", "multline", "eqnarray",
];

/** Reads the optional `{lcr}` or `[t]` argument that `array` and `alignat` take. */
function skipEnvironmentArgs(s: string, from: number): number {
  let i = from;
  for (;;) {
    const ch = s[i];
    if (ch === "{") {
      const group = readGroup(s, i);
      if (!group) return i;
      i = group.end;
    } else if (ch === "[") {
      const close = s.indexOf("]", i);
      if (close < 0) return i;
      i = close + 1;
    } else return i;
  }
}

/**
 * Unwraps a layout environment that holds a single row, and drops the `&`
 * markers that only aligned the columns. An environment with a real row
 * separator is left alone: two rows are two statements, and quietly running
 * them together would invent a problem the student never wrote.
 *
 * Runs before `stripNoise`, which collapses the `\\` that marks those rows.
 */
function unwrapLayoutEnvironments(s: string, notes: string[]): string {
  let out = s;
  let changed = false;
  for (let pass = 0; pass < 6; pass++) {
    let next = out;
    for (const env of LAYOUT_ENVIRONMENTS) {
      for (const name of [env, `${env}*`]) {
        const open = `\\begin{${name}}`;
        const close = `\\end{${name}}`;
        const start = next.indexOf(open);
        if (start < 0) continue;
        const bodyStart = skipEnvironmentArgs(next, start + open.length);
        const end = next.indexOf(close, bodyStart);
        if (end < 0) continue;
        const body = next.slice(bodyStart, end);
        // A trailing separator is just a line ending, not a second row.
        if (/\\\\\s*\S/.test(body)) continue;
        const flattened = body.replace(/\\\\/g, " ").replace(/&/g, " ");
        next = next.slice(0, start) + flattened + next.slice(end + close.length);
        changed = true;
      }
    }
    if (next === out) break;
    out = next;
  }
  if (changed) notes.push("unwrapped a layout environment");
  return out;
}

function unwrapTransparent(s: string, notes: string[]): string {
  let out = s;
  let changed = false;
  for (let pass = 0; pass < 5; pass++) {
    let next = out;
    for (const cmd of TRANSPARENT_WRAPPERS) {
      const marker = `\\${cmd}`;
      let index = next.indexOf(marker);
      while (index >= 0) {
        const after = index + marker.length;
        if (/[a-zA-Z]/.test(next[after] ?? "")) {
          index = next.indexOf(marker, after);
          continue;
        }
        const group = readGroup(next, after);
        if (!group) {
          index = next.indexOf(marker, after);
          continue;
        }
        next = next.slice(0, index) + group.body + next.slice(group.end);
        changed = true;
        index = next.indexOf(marker);
      }
    }
    if (next === out) break;
    out = next;
  }
  if (changed) notes.push("unwrapped text and font commands");
  return out;
}

/** \frac12 and \frac{1}2 both become \frac{1}{2}. */
function braceFractionArguments(s: string, notes: string[]): string {
  let out = "";
  let i = 0;
  let changed = false;
  while (i < s.length) {
    const match = /^\\(frac|dfrac|tfrac|binom)(?![a-zA-Z])/.exec(s.slice(i));
    if (!match) {
      out += s[i];
      i++;
      continue;
    }
    out += `\\${match[1]}`;
    i += match[0].length;
    for (let arg = 0; arg < 2; arg++) {
      while (s[i] === " ") i++;
      const group = readGroup(s, i);
      if (group) {
        out += `{${group.body}}`;
        i = group.end;
      } else if (i < s.length) {
        // LaTeX shorthand takes exactly one token: \frac12 is one half, not
        // twelve over something. A control sequence counts as one token.
        const command = /^\\[a-zA-Z]+/.exec(s.slice(i));
        const token = command ? command[0] : s[i]!;
        out += `{${token}}`;
        i += token.length;
        changed = true;
      }
    }
  }
  if (changed) notes.push("added braces to fraction arguments");
  return out;
}

/** x^2 becomes x^{2}, purely so every exponent renders the same way. */
function braceExponents(s: string, notes: string[]): string {
  const out = s.replace(/\^\s*(\d|[a-zA-Z])(?![}\da-zA-Z])/g, "^{$1}");
  if (out !== s) notes.push("added braces to exponents");
  return out;
}

/**
 * Rejoin numbers that the model split into separate digits.
 *
 * Recognition models tokenise digit by digit, so eleven comes back as "1 1"
 * and 123 as "1 2 3". The parser reads adjacent numbers as implicit
 * multiplication, so an unrepaired scan of "123 + 456" answers 126 rather
 * than 579 — confidently, with a full set of working. Juxtaposing two
 * numerals never means multiplication in real notation (that needs \cdot or
 * brackets), so a run of space-separated digits is always one number.
 *
 * Runs on the raw spacing, before \quad and friends are stripped, so that
 * digits genuinely held apart by a spacing command are left alone. A thin
 * space between digits is a thousands separator and joins.
 */
function joinSplitDigits(s: string, notes: string[]): string {
  let out = s;
  for (let pass = 0; pass < 20; pass++) {
    // 1 1 -> 11, and 1\,000 -> 1000.
    const next = out
      .replace(/(\d)[ \t]+(?=\d)/g, "$1")
      .replace(/(\d)\s*\\[,;:]\s*(?=\d)/g, "$1");
    if (next === out) break;
    out = next;
  }
  // 3 . 1 4 -> 3.14, once the digit runs on each side are whole.
  out = out.replace(/(\d)\s*\.\s*(?=\d)/g, "$1.");
  if (out !== s) notes.push("joined digits the scan had split apart");
  return out;
}

/** `\operatorname{s i n}` and `\mathrm{l o g}` come back spaced out too. */
function joinSpacedNames(s: string, notes: string[]): string {
  const out = s.replace(
    /\\(operatorname|mathrm|mathit|text)\s*\{([^{}]*)\}/g,
    (whole, cmd: string, body: string) => {
      const tight = body.replace(/\s+/g, "");
      return /^[a-zA-Z]+$/.test(tight) ? `\\${cmd}{${tight}}` : whole;
    },
  );
  if (out !== s) notes.push("closed up a spaced-out function name");
  return out;
}

/**
 * Function names the parser knows as commands. A scan that drops the backslash
 * turns `cos(0)` into c*o*s*(0), which is not a parse error — it is the answer
 * 0, shown with working, where the truth is 1. Restoring the backslash is the
 * difference between a right answer and a confidently wrong one.
 */
const FUNCTION_NAMES = [
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "exp",
  // Named operations rather than functions, but they reach the parser the
  // same way and a student types them without the backslash just the same.
  "maclaurin", "taylor",
];

function restoreFunctionNames(s: string, notes: string[]): string {
  // Longest first, so arcsin is not read as arc followed by sin. Neither a
  // preceding backslash (already a command) nor an adjacent letter (part of a
  // longer name, or a run of variables) may match.
  const pattern = new RegExp(
    `(?<![\\\\a-zA-Z])(${FUNCTION_NAMES.join("|")})(?![a-zA-Z])`,
    "g",
  );
  let out = s.replace(pattern, "\\$1");
  // sqrt takes a braced argument, so its parentheses have to become braces.
  out = out.replace(/(?<![\\a-zA-Z])sqrt\s*\(/g, "\\sqrt{");
  if (/\\sqrt\{/.test(out) && !/\\sqrt\{/.test(s)) {
    out = rebracketSqrt(out);
  }
  if (out !== s) notes.push("restored function names the scan had flattened");
  return out;
}

/** Close the brace that replaced `sqrt(`'s opening parenthesis. */
function rebracketSqrt(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("\\sqrt{", i)) {
      out += "\\sqrt{";
      i += "\\sqrt{".length;
      let depth = 1;
      for (; i < s.length && depth > 0; i++) {
        const c = s[i]!;
        if (c === "(") depth++;
        else if (c === ")") { depth--; if (depth === 0) break; }
        out += c;
      }
      out += "}";
      continue;
    }
    out += s[i]!;
  }
  return out;
}

function balanceBraces(s: string, notes: string[]): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "{" && s[i - 1] !== "\\") depth++;
    if (c === "}" && s[i - 1] !== "\\") {
      if (depth === 0) {
        notes.push("dropped an unmatched closing brace");
        continue;
      }
      depth--;
    }
    out += c;
  }
  if (depth > 0) {
    notes.push(`closed ${depth} unmatched brace${depth === 1 ? "" : "s"}`);
    out += "}".repeat(depth);
  }
  return out;
}

function tidySpacing(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s*([+\-=<>])\s*/g, " $1 ")
    .replace(/\s*\^\s*/g, "^")
    .replace(/\s*_\s*/g, "_")
    .replace(/\{\s*-\s*/g, "{-")
    .replace(/\^\s*-\s*/g, "^-")
    .replace(/\{\s+/g, "{")
    .replace(/\s+\}/g, "}")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingPunctuation(s: string, notes: string[]): string {
  const out = s.replace(/[.,;:]+$/, "").trim();
  if (out !== s) notes.push("removed trailing punctuation");
  return out;
}

/** Clean OCR output into parseable LaTeX, reporting what changed. */
/*
 * Worksheets state the task in words before the maths: "Solve for y: y = 6x + 2".
 * Left in place those words are not a comment to the parser — it reads them as
 * a product of single letters — so they have to come off either way. Taking the
 * variable with them is what stops the solver answering a different question
 * than the one asked: `y = 6x + 2` has two variables in it, and without the
 * instruction the preference order picks x.
 */
const INSTRUCTION =
  /^\s*(?:solve|find|determine|isolate)\s+(?:for\s+)?([a-zA-Z])\b(?:\s+in\s+terms\s+of\s+[a-zA-Z]\b)?\s*[:.,]?\s*/i;

function extractInstruction(s: string, notes: string[]): { rest: string; solveFor?: string } {
  const m = INSTRUCTION.exec(s);
  if (!m) return { rest: s };
  const rest = s.slice(m[0].length);
  // "Solve 2x + 3 = 7" names no variable; the `x` matched there is the maths.
  if (!rest.trim()) return { rest: s };
  notes.push("read the instruction in front of the problem");
  return { rest, solveFor: m[1] };
}

export function normalizeWithReport(raw: string): NormalizeReport {
  const notes: string[] = [];
  if (!raw || !raw.trim()) return { latex: "", notes: ["empty result"] };

  let out = raw;
  // Before anything else: the words are not LaTeX and must not be repaired as if
  // they were.
  const instruction = extractInstruction(out, notes);
  out = instruction.rest;
  out = stripDelimiters(out, notes);
  out = replaceUnicode(out, notes);
  // Balance first: every later pass reads balanced groups.
  out = balanceBraces(out, notes);
  // Before stripNoise, so \quad still separates digits it was meant to.
  out = joinSpacedNames(out, notes);
  out = joinSplitDigits(out, notes);
  out = unwrapTransparent(out, notes);
  // Before stripNoise: it collapses the `\\` that marks a second row.
  out = unwrapLayoutEnvironments(out, notes);
  // After unwrapping, so \operatorname{sin} has become a bare sin by now.
  out = restoreFunctionNames(out, notes);
  out = stripNoise(out, notes);
  out = braceFractionArguments(out, notes);
  out = braceExponents(out, notes);
  out = balanceBraces(out, notes);
  out = stripTrailingPunctuation(out, notes);
  out = tidySpacing(out);
  return { latex: out, notes, ...(instruction.solveFor ? { solveFor: instruction.solveFor } : {}) };
}

export function normalizeLatex(raw: string): string {
  return normalizeWithReport(raw).latex;
}

/**
 * Structures the solver has no rules for. Detecting them here turns a confusing
 * parse error into an honest "not supported yet" message. Derivatives came off
 * this list once the rules in @openmath/steps could take them; integrals and
 * limits followed, and limits took infinity with them, since it is the point
 * half of them approach. The solver still declines the ones it cannot do, with
 * a reason naming the expression, which is a better message than this one
 * could give.
 */
const OUT_OF_SCOPE = [
  // Layout-only environments are unwrapped above, so what reaches here is
  // either a matrix or genuinely more than one row. Those are different
  // problems and deserve different messages.
  { pattern: /\\begin\s*\{[A-Za-z]*matrix\*?\}/, label: "matrices" },
  { pattern: /\\begin\s*\{cases\*?\}/, label: "piecewise definitions" },
  { pattern: /\\begin\s*\{/, label: "more than one line of working at a time" },
  { pattern: /\\oint/, label: "contour integrals" },
  // \sum came off this list when the series engine landed; \prod has no
  // rules yet, so it stays.
  { pattern: /\\prod/, label: "products" },
  { pattern: /\\pm|\\mp/, label: "plus-or-minus" },
  // Deleting the sign would silently turn "20\\%" into "20", which is a
  // different problem with a different answer.
  { pattern: /\\%|%/, label: "percentages" },
  // Leibniz notation with no function attached. Left alone the parser reads
  // dy/dx as d*y/(d*x) and cancels to y*x, which is a wrong answer rather
  // than a refusal. d/dx(...) is the form that carries something to
  // differentiate, and it parses.
  { pattern: /(?<![a-zA-Z])d[a-zA-Z]\s*\/\s*d[a-zA-Z]/, label: "dy/dx notation (write d/dx(...) instead)" },
];

export function detectOutOfScope(latex: string): string | null {
  for (const { pattern, label } of OUT_OF_SCOPE) {
    if (pattern.test(latex)) return label;
  }
  return null;
}
