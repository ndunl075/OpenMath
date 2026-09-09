export type TokenKind =
  | "number"
  | "ident"
  | "command"
  | "op"
  | "lparen"
  | "rparen"
  | "lbrace"
  | "rbrace"
  | "lbracket"
  | "rbracket"
  | "bar"
  | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

export class ParseError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.name = "ParseError";
    this.pos = pos;
  }
}

/** Commands that carry no meaning for us and are dropped during lexing. */
const IGNORED = new Set([
  "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits",
  "left", "right", "!", ",", ";", ":", " ", "quad", "qquad", "thinspace",
  "medspace", "thickspace", "negthinspace",
]);

/** Command aliases mapped onto a canonical spelling. */
const ALIAS: Record<string, string> = {
  cdot: "*", times: "*", div: "/", ast: "*",
  le: "<=", leq: "<=", ge: ">=", geq: ">=",
  lt: "<", gt: ">",
  lparen: "(", rparen: ")",
};

const MULTI_CHAR_OPS = ["<=", ">="];

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, value: string, pos: number) => tokens.push({ kind, value, pos });

  while (i < input.length) {
    const c = input[i]!;

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // \command
    if (c === "\\") {
      const start = i;
      i++;
      if (i >= input.length) throw new ParseError("trailing backslash", start);
      const next = input[i]!;
      let name: string;
      if (/[a-zA-Z]/.test(next)) {
        let j = i;
        while (j < input.length && /[a-zA-Z]/.test(input[j]!)) j++;
        name = input.slice(i, j);
        i = j;
      } else {
        // \{ \} \| \, \! and friends
        name = next;
        i++;
      }
      if (IGNORED.has(name)) continue;
      if (name === "{") { push("lbrace", "{", start); continue; }
      if (name === "}") { push("rbrace", "}", start); continue; }
      if (name === "|") { push("bar", "|", start); continue; }
      const aliased = ALIAS[name];
      if (aliased) {
        push("op", aliased, start);
        continue;
      }
      push("command", name, start);
      continue;
    }

    // number
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      const start = i;
      while (i < input.length && /[0-9]/.test(input[i]!)) i++;
      if (input[i] === "." && /[0-9]/.test(input[i + 1] ?? "")) {
        i++;
        while (i < input.length && /[0-9]/.test(input[i]!)) i++;
      }
      push("number", input.slice(start, i), start);
      continue;
    }

    // identifier (single letter; multi-letter runs are implicit products)
    if (/[a-zA-Z]/.test(c)) {
      push("ident", c, i);
      i++;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (MULTI_CHAR_OPS.includes(two)) {
      push("op", two, i);
      i += 2;
      continue;
    }

    switch (c) {
      case "(": push("lparen", "(", i); i++; continue;
      case ")": push("rparen", ")", i); i++; continue;
      case "{": push("lbrace", "{", i); i++; continue;
      case "}": push("rbrace", "}", i); i++; continue;
      case "[": push("lbracket", "[", i); i++; continue;
      case "]": push("rbracket", "]", i); i++; continue;
      case "|": push("bar", "|", i); i++; continue;
      case "+": case "-": case "*": case "/": case "^": case "_": case "=":
      case "<": case ">":
      // Lagrange's prime, as in f'(x). The OCR normalizer already folds the
      // curly Unicode apostrophes onto this character.
      case "'":
      // Factorial, which binds tighter than anything and reads after its
      // operand: 5! and n!.
      case "!":
        push("op", c, i); i++; continue;
      default:
        throw new ParseError(`unexpected character ${JSON.stringify(c)}`, i);
    }
  }

  push("eof", "", input.length);
  return tokens;
}
