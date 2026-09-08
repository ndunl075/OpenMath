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
  out = out.replace(/\\%/g, "");
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
export function normalizeWithReport(raw: string): NormalizeReport {
  const notes: string[] = [];
  if (!raw || !raw.trim()) return { latex: "", notes: ["empty result"] };

  let out = raw;
  out = stripDelimiters(out, notes);
  out = replaceUnicode(out, notes);
  // Balance first: every later pass reads balanced groups.
  out = balanceBraces(out, notes);
  out = unwrapTransparent(out, notes);
  out = stripNoise(out, notes);
  out = braceFractionArguments(out, notes);
  out = braceExponents(out, notes);
  out = balanceBraces(out, notes);
  out = stripTrailingPunctuation(out, notes);
  out = tidySpacing(out);
  return { latex: out, notes };
}

export function normalizeLatex(raw: string): string {
  return normalizeWithReport(raw).latex;
}

/**
 * Structures the solver has no rules for. Detecting them here turns a confusing
 * parse error into an honest "not supported yet" message. Derivatives came off
 * this list once the rules in @openmath/steps could take them; the solver still
 * declines the ones it cannot do, with a reason naming the expression.
 */
const OUT_OF_SCOPE = [
  { pattern: /\\begin\s*\{/, label: "matrices and aligned environments" },
  { pattern: /\\int|\\oint/, label: "integrals" },
  { pattern: /\\sum|\\prod/, label: "sums and products" },
  { pattern: /\\lim/, label: "limits" },
  { pattern: /\\infty/, label: "infinity" },
  { pattern: /\\pm|\\mp/, label: "plus-or-minus" },
];

export function detectOutOfScope(latex: string): string | null {
  for (const { pattern, label } of OUT_OF_SCOPE) {
    if (pattern.test(latex)) return label;
  }
  return null;
}
