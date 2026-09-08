import { lex, ParseError, type Token } from "./lexer.js";
import { Rational } from "./rational.js";
import {
  add, DEFAULT_DERIVATIVE_VARIABLE, diff, div, fn, isConstantSymbol, type MathNode,
  mul, neg, num, pow, rel, type Relation, sym, symbols,
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
  /** Depth of enclosing exponents, so a prime is never read as belonging to one. */
  private exponentDepth = 0;

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
    let node = this.parseAtom();
    if (this.at("op", "^")) {
      this.next();
      this.exponentDepth++;
      try {
        node = pow(node, this.parseFactor());
      } finally {
        this.exponentDepth--;
      }
    }
    // The prime is read after the exponent, so (x^2+1)^3' is the derivative of
    // the cube rather than a derivative of the exponent 3, which would quietly
    // turn the whole expression into 1.
    if (this.exponentDepth === 0 && this.at("op", "'")) {
      let order = 0;
      while (this.eat("op", "'")) order++;
      node = this.applyPrimes(node, order);
    }
    return node;
  }

  /**
   * Lagrange notation. `f'(x)` is one unit: the bracket names the variable, not
   * a factor to multiply by, so it is consumed here rather than left for
   * implicit multiplication. `(x^2+3x)'` and `y''` come through the same path.
   */
  private applyPrimes(base: MathNode, order: number): MathNode {
    let variable: string | null = null;
    if (base.type === "sym" && this.at("lparen")) {
      // f'(x): the bracket names the variable. f itself has no definition here,
      // so this becomes d/dx(f), which the solver declines with a real reason
      // rather than silently answering zero.
      const arg = this.parseGroup2();
      variable = arg.type === "sym" ? arg.name : this.inferVariable(arg);
    }
    const v = variable ?? this.inferVariable(base);
    let out = base;
    for (let k = 0; k < order; k++) out = diff(out, sym(v));
    return out;
  }

  /**
   * Which variable a prime means. `(t^2+1)'` is unambiguous; a bare `y'` is the
   * Leibniz situation, where y is a function of the usual independent variable.
   */
  private inferVariable(n: MathNode): string {
    if (n.type === "sym") return DEFAULT_DERIVATIVE_VARIABLE;
    const free = [...symbols(n)].filter((s) => !isConstantSymbol(s));
    return free.length === 1 ? free[0]! : DEFAULT_DERIVATIVE_VARIABLE;
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
      const operator = this.tryDifferentialOperator();
      if (operator) return this.parseDerivative(operator);
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

  /**
   * Read `{d}` or `{dy}` at token offset `k`, the two halves of a Leibniz
   * derivative. Returns the name after the d (empty for a bare `{d}`) and the
   * offset just past the closing brace.
   *
   * This is a token lookahead rather than a rewrite of the input text: by the
   * time \frac has been consumed the shape is only three or four tokens, and
   * matching them directly keeps `\frac{d}{dx}` from ever being built as a
   * fraction and then guessed back into a derivative.
   */
  private readDifferentialGroup(k: number): { name: string; order: number; next: number } | null {
    if (this.t[k]?.kind !== "lbrace") return null;
    let j = k + 1;
    const head = this.t[j];
    if (!head || head.kind !== "ident" || head.value !== "d") return null;
    j++;

    // The order sits after the d on top and after the variable underneath:
    // \frac{d^{2}}{dx^{2}}. Without this the whole thing parses as a fraction
    // of a variable called d and answers something that is not a derivative.
    let order = 1;
    const topOrder = this.readOrderSuffix(j);
    if (topOrder) {
      order = topOrder.order;
      j = topOrder.next;
    }

    let name = "";
    const tail = this.t[j];
    if (tail && (tail.kind === "ident" || (tail.kind === "command" && GREEK.has(tail.value)))) {
      name = tail.value;
      j++;
      const bottomOrder = this.readOrderSuffix(j);
      if (bottomOrder) {
        if (topOrder) return null;
        order = bottomOrder.order;
        j = bottomOrder.next;
      }
    }
    if (this.t[j]?.kind !== "rbrace") return null;
    return { name, order, next: j + 1 };
  }

  /** An exponent read as a derivative order: a small positive integer. */
  private readOrderSuffix(k: number): { order: number; next: number } | null {
    const caret = this.t[k];
    if (!caret || caret.kind !== "op" || caret.value !== "^") return null;
    let j = k + 1;
    const braced = this.t[j]?.kind === "lbrace";
    if (braced) j++;
    const digits = this.t[j];
    if (!digits || digits.kind !== "number" || !/^[0-9]+$/.test(digits.value)) return null;
    const order = Number(digits.value);
    if (!Number.isInteger(order) || order < 1 || order > 8) return null;
    j++;
    if (braced) {
      if (this.t[j]?.kind !== "rbrace") return null;
      j++;
    }
    return { order, next: j };
  }

  /**
   * `\frac{d}{dx}` and `\frac{dy}{dx}`, consumed only on a full match so a
   * genuine fraction of two variables called d and x still parses as division.
   */
  private tryDifferentialOperator(): { variable: string; target: string; order: number } | null {
    const top = this.readDifferentialGroup(this.i);
    if (!top) return null;
    const bottom = this.readDifferentialGroup(top.next);
    if (!bottom || bottom.name === "") return null;
    // d^2/dx^2 is a second derivative; d^2/dx^3 is not anything, so leave it a
    // fraction rather than inventing an order.
    if (top.order !== bottom.order) return null;
    this.i = bottom.next;
    return { variable: bottom.name, target: top.name, order: top.order };
  }

  private parseDerivative(op: { variable: string; target: string; order: number }): MathNode {
    // \frac{dy}{dx}: y is defined elsewhere, if at all. Parsing it as d/dx(y)
    // keeps it in one piece so the solver can decline it with a real reason
    // instead of the parser guessing what y stands for.
    const base = op.target !== "" ? sym(op.target) : this.parseDerivativeOperand();
    let out = base;
    for (let k = 0; k < op.order; k++) out = diff(out, sym(op.variable));
    return out;
  }

  /**
   * What the operator applies to.
   *
   * A bracket closes the operand, so `\frac{d}{dx}(x)(y)` is the derivative of
   * x multiplied by y, not the derivative of xy; that keeps a serialized product
   * rule step reading back as the same expression. An exponent on the bracket
   * still belongs to the operand though — `\frac{d}{dx}(x^2+1)^3` is the
   * derivative of the cube — which is why this takes a whole factor rather than
   * just the group. Without brackets the operand runs on the way `\sin 2x` does.
   */
  private parseDerivativeOperand(): MathNode {
    if (this.at("lparen") || this.at("lbrace")) return this.parseFactor();
    return this.parseImplicitRun();
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
