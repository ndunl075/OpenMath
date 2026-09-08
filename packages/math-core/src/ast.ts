import { Rational } from "./rational.js";

/**
 * Every node carries a stable id. Rules that move a subtree reuse the same node
 * object (and therefore the same id), so the animation layer can match a term in
 * `before` to the same term in `after` by id instead of guessing from position.
 * New nodes a rule creates get fresh ids and are reported in Change.toIds.
 */
export type NodeId = number;

let counter = 0;
export function freshId(): NodeId {
  return ++counter;
}
/** Test-only: make ids deterministic across runs. */
export function resetIds(to = 0): void {
  counter = to;
}

export type Relation = "=" | "<" | ">" | "<=" | ">=";

export type MathNode =
  | { type: "num"; id: NodeId; value: Rational }
  | { type: "sym"; id: NodeId; name: string }
  | { type: "add"; id: NodeId; args: MathNode[] }
  | { type: "mul"; id: NodeId; args: MathNode[] }
  | { type: "div"; id: NodeId; num: MathNode; den: MathNode }
  | { type: "pow"; id: NodeId; base: MathNode; exp: MathNode }
  | { type: "neg"; id: NodeId; arg: MathNode }
  | { type: "fn"; id: NodeId; name: string; args: MathNode[] }
  | { type: "rel"; id: NodeId; rel: Relation; lhs: MathNode; rhs: MathNode };

export type NodeType = MathNode["type"];

// ---------------------------------------------------------------- constructors

export const num = (v: Rational | bigint | number, id = freshId()): MathNode => ({
  type: "num",
  id,
  value: v instanceof Rational ? v : Rational.of(v as bigint | number),
});
export const sym = (name: string, id = freshId()): MathNode => ({ type: "sym", id, name });
export const add = (args: MathNode[], id = freshId()): MathNode => ({ type: "add", id, args });
export const mul = (args: MathNode[], id = freshId()): MathNode => ({ type: "mul", id, args });
export const div = (n: MathNode, d: MathNode, id = freshId()): MathNode => ({
  type: "div",
  id,
  num: n,
  den: d,
});
export const pow = (base: MathNode, exp: MathNode, id = freshId()): MathNode => ({
  type: "pow",
  id,
  base,
  exp,
});
export const neg = (arg: MathNode, id = freshId()): MathNode => ({ type: "neg", id, arg });
export const fn = (name: string, args: MathNode[], id = freshId()): MathNode => ({
  type: "fn",
  id,
  name,
  args,
});
export const rel = (r: Relation, lhs: MathNode, rhs: MathNode, id = freshId()): MathNode => ({
  type: "rel",
  id,
  rel: r,
  lhs,
  rhs,
});

export const ZERO = (): MathNode => num(Rational.ZERO);
export const ONE = (): MathNode => num(Rational.ONE);

// ------------------------------------------------------------------- accessors

export function children(n: MathNode): MathNode[] {
  switch (n.type) {
    case "num":
    case "sym":
      return [];
    case "add":
    case "mul":
    case "fn":
      return n.args;
    case "div":
      return [n.num, n.den];
    case "pow":
      return [n.base, n.exp];
    case "neg":
      return [n.arg];
    case "rel":
      return [n.lhs, n.rhs];
  }
}

/** Rebuild a node with new children, keeping its own id. */
export function withChildren(n: MathNode, kids: MathNode[]): MathNode {
  switch (n.type) {
    case "num":
    case "sym":
      return n;
    case "add":
      return { ...n, args: kids };
    case "mul":
      return { ...n, args: kids };
    case "fn":
      return { ...n, args: kids };
    case "div":
      return { ...n, num: kids[0]!, den: kids[1]! };
    case "pow":
      return { ...n, base: kids[0]!, exp: kids[1]! };
    case "neg":
      return { ...n, arg: kids[0]! };
    case "rel":
      return { ...n, lhs: kids[0]!, rhs: kids[1]! };
  }
}

/** Same node, new id. Use when a rule conceptually creates a value. */
export function reid(n: MathNode): MathNode {
  return { ...n, id: freshId() };
}

/** Every occurrence of a symbol replaced by an expression, which arrives fresh
 * each time so the copies do not share ids. Substituting a limit into an
 * antiderivative is what it is for. */
export function substituteSymbol(n: MathNode, name: string, value: MathNode): MathNode {
  if (n.type === "sym" && n.name === name) return cloneFresh(value);
  const kids = children(n);
  if (kids.length === 0) return n;
  return withChildren(n, kids.map((k) => substituteSymbol(k, name, value)));
}

/** Deep copy with entirely fresh ids. */
export function cloneFresh(n: MathNode): MathNode {
  const kids = children(n).map(cloneFresh);
  return { ...withChildren(n, kids), id: freshId() } as MathNode;
}

// -------------------------------------------------------------------- traversal

export type Path = readonly number[];

export function nodeAt(root: MathNode, path: Path): MathNode | undefined {
  let cur: MathNode | undefined = root;
  for (const i of path) {
    if (!cur) return undefined;
    cur = children(cur)[i];
  }
  return cur;
}

/** Replace the node at `path`, keeping every id along the way except the target's. */
export function replaceAt(root: MathNode, path: Path, next: MathNode): MathNode {
  if (path.length === 0) return next;
  const [i, ...rest] = path as number[];
  const kids = children(root).slice();
  const target = kids[i!];
  if (!target) return root;
  kids[i!] = replaceAt(target, rest, next);
  return withChildren(root, kids);
}

export function walk(root: MathNode, visit: (n: MathNode, path: Path) => void, path: Path = []): void {
  visit(root, path);
  children(root).forEach((c, i) => walk(c, visit, [...path, i]));
}

export function findPath(root: MathNode, pred: (n: MathNode) => boolean): Path | null {
  let found: Path | null = null;
  walk(root, (n, p) => {
    if (found === null && pred(n)) found = p;
  });
  return found;
}

export function collectIds(n: MathNode): NodeId[] {
  const out: NodeId[] = [];
  walk(n, (x) => out.push(x.id));
  return out;
}

/**
 * Does this expression divide by a literal zero anywhere?
 *
 * Checked on the way in and on the way out: `1/(x-x)` only becomes `1/0` after
 * the terms cancel, and returning that as an answer would present an undefined
 * expression as though it were one.
 */
export function hasDivisionByZero(n: MathNode): boolean {
  let found = false;
  walk(n, (x) => {
    if (x.type === "div" && isZero(x.den)) found = true;
    if (x.type === "pow" && isZero(x.base) && x.exp.type === "num" && x.exp.value.isNegative()) {
      found = true;
    }
  });
  return found;
}

export function symbols(n: MathNode): Set<string> {
  const out = new Set<string>();
  walk(n, (x) => {
    if (x.type === "sym") out.add(x.name);
  });
  return out;
}

export function countNodes(n: MathNode): number {
  let c = 0;
  walk(n, () => c++);
  return c;
}

// ------------------------------------------------------------------- comparison

/** Structural equality, ignoring ids. Not mathematical equality. */
export function sameStructure(a: MathNode, b: MathNode): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "num" && b.type === "num") return a.value.equals(b.value);
  if (a.type === "sym" && b.type === "sym") return a.name === b.name;
  if (a.type === "fn" && b.type === "fn" && a.name !== b.name) return false;
  if (a.type === "rel" && b.type === "rel" && a.rel !== b.rel) return false;
  const ka = children(a);
  const kb = children(b);
  if (ka.length !== kb.length) return false;
  return ka.every((c, i) => sameStructure(c, kb[i]!));
}

/**
 * Canonical string ignoring ids. Two nodes with the same key are interchangeable,
 * which is how like terms are grouped. Commutative args are sorted so
 * `x*y` and `y*x` share a key.
 */
export function key(n: MathNode): string {
  switch (n.type) {
    case "num":
      return `#${n.value.toString()}`;
    case "sym":
      return `$${n.name}`;
    case "add":
      return `(+ ${n.args.map(key).sort().join(" ")})`;
    case "mul":
      return `(* ${n.args.map(key).sort().join(" ")})`;
    case "div":
      return `(/ ${key(n.num)} ${key(n.den)})`;
    case "pow":
      return `(^ ${key(n.base)} ${key(n.exp)})`;
    case "neg":
      return `(- ${key(n.arg)})`;
    case "fn":
      return `(${n.name} ${n.args.map(key).join(" ")})`;
    case "rel":
      return `(${n.rel} ${key(n.lhs)} ${key(n.rhs)})`;
  }
}

/** Deterministic ordering used to present terms in a stable, readable order. */
export function compareNodes(a: MathNode, b: MathNode): number {
  const rank = (n: MathNode): number =>
    n.type === "num" ? 3 : n.type === "sym" ? 1 : n.type === "pow" ? 0 : 2;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
}

// --------------------------------------------------------------------- helpers

export function isNum(n: MathNode | undefined): n is Extract<MathNode, { type: "num" }> {
  return !!n && n.type === "num";
}
export function isZero(n: MathNode): boolean {
  return n.type === "num" && n.value.isZero();
}
export function isOne(n: MathNode): boolean {
  return n.type === "num" && n.value.isOne();
}
export function isNegativeNum(n: MathNode): boolean {
  return n.type === "num" && n.value.isNegative();
}

/** Flatten nested add/mul of the same type into one arg list. */
export function flatten(n: MathNode): MathNode {
  if (n.type !== "add" && n.type !== "mul") return n;
  const out: MathNode[] = [];
  for (const a of n.args) {
    if (a.type === n.type) out.push(...(a as typeof n).args);
    else out.push(a);
  }
  return { ...n, args: out };
}

/**
 * Split a product into its rational coefficient and the remaining factors.
 * `-3x^2` -> { coeff: -3, rest: [x^2] }. The backbone of like-term collection.
 */
export function splitCoefficient(n: MathNode): { coeff: Rational; rest: MathNode[] } {
  if (n.type === "num") return { coeff: n.value, rest: [] };
  if (n.type === "neg") {
    const inner = splitCoefficient(n.arg);
    return { coeff: inner.coeff.neg(), rest: inner.rest };
  }
  if (n.type === "mul") {
    let coeff = Rational.ONE;
    const rest: MathNode[] = [];
    for (const a of n.args) {
      const s = splitCoefficient(a);
      coeff = coeff.mul(s.coeff);
      rest.push(...s.rest);
    }
    return { coeff, rest };
  }
  return { coeff: Rational.ONE, rest: [n] };
}

/** Rebuild `coeff * rest`, dropping the coefficient when it is 1. */
export function makeTerm(coeff: Rational, rest: MathNode[]): MathNode {
  if (rest.length === 0) return num(coeff);
  if (coeff.isZero()) return ZERO();
  const body = rest.length === 1 ? rest[0]! : mul(rest);
  if (coeff.isOne()) return body;
  if (coeff.equals(Rational.NEG_ONE)) return neg(body);
  return mul([num(coeff), body]);
}

// ------------------------------------------------------------------ constants

/**
 * Symbols that name a fixed number rather than a free variable. Anything here
 * is excluded from `freeSymbols`, so the verifier samples around it instead of
 * treating it as an unknown, and `evaluateNumeric` knows its value.
 */
const CONSTANT_SYMBOLS: ReadonlySet<string> = new Set(["pi", "e"]);

export function isConstantSymbol(name: string): boolean {
  return CONSTANT_SYMBOLS.has(name);
}

/** Symbols a value genuinely varies with, i.e. `symbols` minus the constants. */
export function freeSymbols(n: MathNode): Set<string> {
  const out = new Set<string>();
  for (const s of symbols(n)) if (!isConstantSymbol(s)) out.add(s);
  return out;
}

// ----------------------------------------------------------------- derivatives

export type FnNode = Extract<MathNode, { type: "fn" }>;

/** The variable a derivative is taken with respect to when nothing names one. */
export const DEFAULT_DERIVATIVE_VARIABLE = "x";

/**
 * d/dv(expr), written as an ordinary `fn` node so every traversal, serializer
 * and id-keyed animation already in place keeps working unchanged. The rules in
 * `packages/steps/src/rules/derivative.ts` are what give it meaning; until they
 * have fired the node is opaque, which is exactly what lets the solver notice a
 * derivative it cannot do and decline instead of half-answering.
 */
export const diff = (expr: MathNode, variable: MathNode, id = freshId()): MathNode =>
  fn("diff", [expr, variable], id);

/** Read a node as a derivative, or null when it is not one. */
export function asDiff(
  n: MathNode,
): { node: FnNode; body: MathNode; variable: string } | null {
  if (n.type !== "fn" || n.name !== "diff") return null;
  const [body, v] = n.args;
  if (!body || !v || v.type !== "sym") return null;
  return { node: n, body, variable: v.name };
}

export function containsDiff(n: MathNode): boolean {
  let found = false;
  walk(n, (x) => {
    if (x.type === "fn" && x.name === "diff") found = true;
  });
  return found;
}

/** The outermost derivative in `n`. `walk` is pre-order, so this is the top one. */
export function firstDiff(n: MathNode): FnNode | null {
  const path = findPath(n, (x) => x.type === "fn" && x.name === "diff");
  if (!path) return null;
  const node = nodeAt(n, path);
  return node && node.type === "fn" ? node : null;
}

// ------------------------------------------------------------------ integrals

/**
 * An integral, written as an ordinary `fn` node for the same reason `diff` is:
 * every traversal, serializer and id-keyed animation already in place keeps
 * working unchanged. The indefinite form carries the integrand and the
 * variable; the definite form carries its two limits after them, so one node
 * shape covers both and the rules can refuse a definite integral by looking at
 * `args.length`.
 *
 * Until the rules in `packages/steps/src/rules/integral.ts` have fired the node
 * is opaque, which is what lets the solver notice an integral it cannot do and
 * decline instead of returning half an answer.
 */
export const integral = (body: MathNode, variable: MathNode, id = freshId()): MathNode =>
  fn("integral", [body, variable], id);

export const definiteIntegral = (
  body: MathNode,
  variable: MathNode,
  lower: MathNode,
  upper: MathNode,
  id = freshId(),
): MathNode => fn("integral", [body, variable, lower, upper], id);

export interface IntegralParts {
  node: FnNode;
  body: MathNode;
  variable: string;
  /** Present only on a definite integral. */
  bounds?: { lower: MathNode; upper: MathNode };
}

/** Read a node as an integral, or null when it is not one. */
export function asIntegral(n: MathNode): IntegralParts | null {
  if (n.type !== "fn" || n.name !== "integral") return null;
  const [body, v, lower, upper] = n.args;
  if (!body || !v || v.type !== "sym") return null;
  if (n.args.length === 2) return { node: n, body, variable: v.name };
  if (n.args.length === 4 && lower && upper) {
    return { node: n, body, variable: v.name, bounds: { lower, upper } };
  }
  return null;
}

export function containsIntegral(n: MathNode): boolean {
  let found = false;
  walk(n, (x) => {
    if (x.type === "fn" && x.name === "integral") found = true;
  });
  return found;
}

/** The outermost integral in `n`. `walk` is pre-order, so this is the top one. */
export function firstIntegral(n: MathNode): FnNode | null {
  const path = findPath(n, (x) => x.type === "fn" && x.name === "integral");
  if (!path) return null;
  const node = nodeAt(n, path);
  return node && node.type === "fn" ? node : null;
}
