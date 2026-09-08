import { lex, ParseError, type Token } from "./lexer.js";
import { Rational } from "./rational.js";
import {
  add, div, fn, type MathNode, mul, neg, num, pow, rel, type Relation, sym,
} from "./ast.js";

export { ParseError };

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "ln", "log", "exp", "abs",
]);

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu",
  "pi", "rho", "sigma", "tau", "phi", "omega",
]);

const RELATIONS: Relation[] = ["=", "<", ">", "<=", ">="];

class Parser {
  private readonly t: Token[];
  private i = 0;
  /** Depth of enclosing |...| so a closing bar is not read as a new factor. */
  private barDepth = 0;

  constructor(src: string) {
    this.t = lex(src);
  }

  private peek(): Token {
    return this.t[this.i]!;
  }
  private next(): Token {
    return this.t[this.i++]!;
  }
  private at(kind: Token["kind"], value?: string): boolean {
    const tk = this.peek();
    return tk.kind === kind && (value === undefined || tk.value === value);
  }
  private eat(kind: Token["kind"], value?: string): boolean {
    if (this.at(kind, value)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(kind: Token["kind"], value?: string): Token {
    if (!this.at(kind, value)) {
      const tk = this.peek();
      throw new ParseError(
        `expected ${value ?? kind} but found ${tk.kind === "eof" ? "end of input" : JSON.stringify(tk.value)}`,
        tk.pos,
      );
    }
    return this.next();
  }

  parse(): MathNode {
    const node = this.parseRelation();
    if (!this.at("eof")) {
      const tk = this.peek();
      throw new ParseError(`unexpected ${JSON.stringify(tk.value)}`, tk.pos);
    }
    return node;
  }

  private parseRelation(): MathNode {
    const lhs = this.parseExpr();
    const tk = this.peek();
    if (tk.kind === "op" && (RELATIONS as string[]).includes(tk.value)) {
      this.next();
      const rhs = this.parseExpr();
      if (this.peek().kind === "op" && (RELATIONS as string[]).includes(this.peek().value)) {
        throw new ParseError("chained relations are not supported", this.peek().pos);
      }
      return rel(tk.value as Relation, lhs, rhs);
    }
    return lhs;
  }

  private parseExpr(): MathNode {
    const terms: MathNode[] = [this.parseTerm()];
    for (;;) {
      if (this.at("op", "+")) {
        this.next();
        terms.push(this.parseTerm());
      } else if (this.at("op", "-")) {
        this.next();
        terms.push(neg(this.parseTerm()));
      } else break;
    }
    return terms.length === 1 ? terms[0]! : add(terms);
  }

  private parseTerm(): MathNode {
    let acc = this.parseFactor();
    for (;;) {
      if (this.at("op", "*")) {
        this.next();
        acc = this.mulFlat(acc, this.parseFactor());
      } else if (this.at("op", "/")) {
        this.next();
        acc = div(acc, this.parseFactor());
      } else if (this.startsFactor()) {
        acc = this.mulFlat(acc, this.parseFactor());
      } else break;
    }
    return acc;
  }

  private mulFlat(a: MathNode, b: MathNode): MathNode {
    if (a.type === "mul") return mul([...a.args, b], a.id);
    return mul([a, b]);
  }

  /** True when the current token can begin a factor, i.e. implicit multiplication. */
  private startsFactor(): boolean {
    const tk = this.peek();
    switch (tk.kind) {
      case "number":
      case "ident":
      case "lparen":
      case "lbrace":
        return true;
      case "bar":
        return this.barDepth === 0;
      case "command":
        return true;
      default:
        return false;
    }
  }

  private parseFactor(): MathNode {
    if (this.at("op", "-")) {
      this.next();
      return neg(this.parseFactor());
    }
    if (this.at("op", "+")) {
      this.next();
      return this.parseFactor();
    }
    return this.parsePower();
  }

  private parsePower(): MathNode {
    const base = this.parseAtom();
    if (this.at("op", "^")) {
      this.next();
      return pow(base, this.parseFactor());
    }
    return base;
  }

  /** A braced group, or a single atom when the author omitted braces. */
  private parseGroup(): MathNode {
    if (this.at("lbrace")) {
      this.next();
      const e = this.parseExpr();
      this.expect("rbrace");
      return e;
    }
    return this.parseAtom();
  }

  /** Function argument: a run of implicitly multiplied factors, so `\sin 2x` is sin(2x). */
  private parseImplicitRun(): MathNode {
    let acc = this.parseFactor();
    while (this.startsFactor()) {
      acc = this.mulFlat(acc, this.parseFactor());
    }
    return acc;
  }

  private parseAtom(): MathNode {
    const tk = this.peek();
    switch (tk.kind) {
      case "number":
        this.next();
        return num(Rational.parse(tk.value));

      case "ident": {
        this.next();
        let name = tk.value;
        if (this.at("op", "_")) {
          this.next();
          name += "_" + this.readSubscriptText();
        }
        return sym(name);
      }

      case "lparen": {
        this.next();
        const e = this.parseExpr();
        this.expect("rparen");
        return e;
      }

      case "lbrace": {
        this.next();
        const e = this.parseExpr();
        this.expect("rbrace");
        return e;
      }

      case "bar": {
        this.next();
        this.barDepth++;
        let e: MathNode;
        try {
          e = this.parseExpr();
        } finally {
          this.barDepth--;
        }
        this.expect("bar");
        return fn("abs", [e]);
      }

      case "command":
        return this.parseCommand(tk);

      default:
        throw new ParseError(
          `unexpected ${tk.kind === "eof" ? "end of input" : JSON.stringify(tk.value)}`,
          tk.pos,
        );
    }
  }

  private readSubscriptText(): string {
    if (this.at("lbrace")) {
      this.next();
      let s = "";
      while (!this.at("rbrace")) {
        if (this.at("eof")) throw new ParseError("unclosed subscript", this.peek().pos);
        s += this.next().value;
      }
      this.expect("rbrace");
      return s;
    }
    return this.next().value;
  }

  private parseCommand(tk: Token): MathNode {
    const name = tk.value;
    this.next();

    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const n = this.parseGroup();
      const d = this.parseGroup();
      return div(n, d);
    }

    if (name === "sqrt") {
      if (this.at("lbracket")) {
        this.next();
        const degree = this.parseExpr();
        this.expect("rbracket");
        const radicand = this.parseGroup();
        return fn("root", [radicand, degree]);
      }
      return fn("sqrt", [this.parseGroup()]);
    }

    if (name === "pm" || name === "mp") {
      throw new ParseError("\\pm is not supported yet", tk.pos);
    }

    if (FUNCTIONS.has(name)) {
      let base: MathNode | null = null;
      if (this.at("op", "_")) {
        this.next();
        base = this.parseGroup();
      }
      const arg = this.at("lparen") || this.at("lbrace")
        ? this.parseGroup2()
        : this.parseImplicitRun();
      return base ? fn(name, [arg, base]) : fn(name, [arg]);
    }

    if (GREEK.has(name)) return sym(name);

    throw new ParseError(`unsupported command \\${name}`, tk.pos);
  }

  /** Parenthesised or braced group, used for `\sin(x)`. */
  private parseGroup2(): MathNode {
    if (this.at("lparen")) {
      this.next();
      const e = this.parseExpr();
      this.expect("rparen");
      return e;
    }
    return this.parseGroup();
  }
}

/** Parse a LaTeX expression or equation into an AST. Throws ParseError. */
export function parseLatex(src: string): MathNode {
  return new Parser(src).parse();
}

/** Non-throwing variant. */
export function tryParseLatex(src: string): { ok: true; node: MathNode } | { ok: false; error: string; pos: number } {
  try {
    return { ok: true, node: parseLatex(src) };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message, pos: e.pos };
    return { ok: false, error: e instanceof Error ? e.message : String(e), pos: 0 };
  }
}
