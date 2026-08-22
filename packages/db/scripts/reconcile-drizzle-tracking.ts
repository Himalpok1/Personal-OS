// Reconciles drizzle.__drizzle_migrations tracking rows against meta/_journal.json.
//
// Why this exists (Checkpoint 5.3 prerequisite): migration 0009's DDL was applied
// to dev/test databases via psql without tracking rows, so `drizzle-kit migrate`
// replays 0009 and fails on its duplicate constraint. This tool backfills missing
// tracking rows ONLY after proving, via catalog probes mechanically derived from
// each migration's own SQL statements, that every object the migration creates is
// already present and identical in the target database.
//
// Load-bearing invariants:
// - Watermark semantics mirror drizzle-orm node-postgres migrate() exactly:
//   watermark = max(created_at) over tracked rows; an entry counts as applied iff
//   entry.when > watermark (strict). An entry with when <= watermark whose hash is
//   absent from the table is a historical inconsistency -> ABORT for a human
//   decision, never silently backfill.
// - Inserted created_at values are ALWAYS the journal's `when` (the migrator's
//   folderMillis), NEVER Date.now() -- production parity depends on inserting the
//   exact journal values drizzle-kit itself would have inserted.
// - Fail-closed: every SQL statement of a backfill candidate must translate into
//   an explicit catalog assertion; any statement class this script cannot verify
//   aborts the run before any insert.
//
// Exit codes: 0 = consistent (or reconciled successfully); 1 = --check found
// work to do, or any abort/fail-closed condition; 2 = usage/config error.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";

const BREAKPOINT_MARKER = "--> statement-breakpoint";

// Arbitrary but FIXED cluster-scoped advisory-lock key reserved for this tool
// (FNV-1a of "personal-os:drizzle-tracking-reconcile" folded to 64 bits). Passed
// as a string parameter with an explicit ::bigint cast so the value never passes
// through JS float precision. Serializes concurrent reconcilers inside one
// transaction; the post-lock re-read below also makes racing drizzle-kit migrate
// detectable.
const RECONCILE_ADVISORY_LOCK_KEY = "5589655714121198000";

export class AbortError extends Error {}

function abort(message: string): never {
  throw new AbortError(message);
}

// ---------------------------------------------------------------------------
// Pure: journal loading + hashing (must mirror drizzle migrator.cjs exactly)
// ---------------------------------------------------------------------------

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  hash: string;
  statements: string[];
}

export interface TrackingRow {
  id: number;
  hash: string;
  createdAtRaw: string;
  createdAt: number;
}

/**
 * One catalog assertion derived from a single migration SQL statement.
 * Every statement of a missing migration must yield exactly one probe;
 * statements that cannot yield one abort the run (fail-closed).
 */
export type Probe =
  | { kind: "table"; label: string; regclassInput: string }
  | {
      kind: "column";
      label: string;
      table: string;
      column: string;
      dataType: string;
      nullable: boolean;
      defaultExpr: string | null;
    }
  | { kind: "drop-not-null"; label: string; table: string; column: string }
  | {
      kind: "constraint-check";
      label: string;
      table: string;
      name: string;
      canonicalBody: string;
    }
  | {
      kind: "constraint-fk";
      label: string;
      table: string;
      name: string;
      columns: string[];
      refTable: string;
      refColumns: string[];
      onDelete: string | null;
      onUpdate: string | null;
    }
  | {
      kind: "index";
      label: string;
      name: string;
      unique: boolean;
      tableName: string;
      method: string;
      columns: string[];
      canonicalWhere: string | null;
    };

/** sha256 hex of the ENTIRE raw .sql file text, exactly like readMigrationFiles. */
export function sqlFileHash(fileContent: string): string {
  return createHash("sha256").update(fileContent).digest("hex");
}

interface RawJournalEntry {
  idx?: unknown;
  when?: unknown;
  tag?: unknown;
}

export function loadJournalEntries(migrationsFolder: string): JournalEntry[] {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(journalPath).toString());
  } catch (err) {
    return abort(`cannot read/parse ${journalPath}: ${String(err)}`);
  }
  const rawEntries = (parsed as { entries?: RawJournalEntry[] } | null)?.entries;
  if (!Array.isArray(rawEntries)) {
    return abort(`${journalPath} has no entries array`);
  }
  const entries: JournalEntry[] = [];
  for (const raw of rawEntries) {
    const { idx, when, tag } = raw;
    if (typeof idx !== "number" || typeof when !== "number" || typeof tag !== "string") {
      return abort(`malformed journal entry: ${JSON.stringify(raw)}`);
    }
    const sqlPath = join(migrationsFolder, `${tag}.sql`);
    let fileContent: string;
    try {
      // Same decode as the migrator: raw bytes -> utf-8 string -> hashed whole.
      fileContent = readFileSync(sqlPath).toString();
    } catch {
      return abort(`No file ${sqlPath} found in migrations folder`);
    }
    entries.push({
      idx,
      when,
      tag,
      hash: sqlFileHash(fileContent),
      statements: splitSqlStatements(fileContent),
    });
  }
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (prev && cur && cur.when <= prev.when) {
      return abort(`journal entries not strictly increasing by \`when\` at idx ${String(cur.idx)}`);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Pure: SQL statement splitting
// ---------------------------------------------------------------------------

/**
 * Splits a migration file into individual statements. Drizzle-generated files
 * carry `--> statement-breakpoint` markers; hand-written ones (0000, 0009) are
 * plain semicolon-separated SQL. Both forms go through a quote/comment-aware
 * semicolon split so probes can be derived per statement. Comment-only and
 * empty pieces are dropped.
 */
export function splitSqlStatements(rawSql: string): string[] {
  const chunks = rawSql.includes(BREAKPOINT_MARKER) ? rawSql.split(BREAKPOINT_MARKER) : [rawSql];
  const statements: string[] = [];
  for (const chunk of chunks) {
    for (const piece of splitOnTopLevelSemicolons(chunk)) {
      const cleaned = stripComments(piece).trim();
      if (cleaned.length > 0) {
        statements.push(cleaned);
      }
    }
  }
  return statements;
}

function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    const next = i + 1 < sql.length ? sql.charAt(i + 1) : "";
    if (ch === "'") {
      const end = scanSingleQuoted(sql, i);
      out += sql.slice(i, end);
      i = end;
    } else if (ch === '"') {
      const end = scanDoubleQuoted(sql, i);
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "-" && next === "-") {
      while (i < sql.length && sql.charAt(i) !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function splitOnTopLevelSemicolons(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    const next = i + 1 < sql.length ? sql.charAt(i + 1) : "";
    if (ch === "'") {
      const end = scanSingleQuoted(sql, i);
      current += sql.slice(i, end);
      i = end;
    } else if (ch === '"') {
      const end = scanDoubleQuoted(sql, i);
      current += sql.slice(i, end);
      i = end;
    } else if (ch === "-" && next === "-") {
      while (i < sql.length && sql.charAt(i) !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (ch === ";") {
      parts.push(current);
      current = "";
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  parts.push(current);
  return parts;
}

function scanSingleQuoted(sql: string, start: number): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql.charAt(i) === "'" && sql.charAt(i + 1) === "'") {
      i += 2;
    } else if (sql.charAt(i) === "'") {
      return i + 1;
    } else {
      i++;
    }
  }
  return sql.length;
}

function scanDoubleQuoted(sql: string, start: number): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === '"' && sql[i + 1] === '"') {
      i += 2;
    } else if (sql[i] === '"') {
      return i + 1;
    } else {
      i++;
    }
  }
  return sql.length;
}

// ---------------------------------------------------------------------------
// Pure: normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes column DEFAULT expressions so SQL source (`'basic'`, `now()`) and
 * information_schema renderings (`'basic'::text`, `now()`) compare equal.
 */
export function normalizeDefaultExpr(expr: string | null): string | null {
  if (expr === null) return null;
  let t = expr.trim().toLowerCase().replace(/\s+/g, "");
  t = t.replace(/^('(?:[^']|'')*')(?:::[a-z0-9_]+)+$/, "$1");
  return t;
}

/** Lowercase, drop identifier quotes, collapse whitespace runs to one space. */
function collapseDef(text: string): string {
  return text.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Pure: boolean-expression canonicalizer (CHECK bodies, index WHERE clauses)
// ---------------------------------------------------------------------------

/**
 * Canonicalizes a boolean/comparison expression so the SQL-source form and
 * Postgres's rendered form (pg_get_constraintdef / pg_indexes.indexdef) compare
 * equal. Postgres rewrites IN-lists as `= ANY (ARRAY[...])`, drops redundant
 * parentheses, casts literals (`'x'::text`), strips table qualifiers from column
 * refs, changes keyword case, and reformats whitespace -- all mirrored here.
 *
 * Implementation: tokenize -> recursive-descent parse into an AND/OR tree ->
 * sort children of order-insensitive positions (AND/OR operands, IN/ARRAY
 * members) -> render canonical s-expression. Any construct outside the supported
 * grammar throws AbortError (fail-closed).
 */
export function canonBooleanExpr(expr: string): string {
  const tokens = tokenizeBoolExpr(collapseDef(expr));
  const parser = new BoolExprParser(tokens);
  const ast = parser.parseOr();
  parser.expectEnd();
  return renderBoolAst(ast);
}

type BoolToken =
  | { t: "str"; v: string }
  | { t: "num"; v: string }
  | { t: "id"; v: string }
  | { t: "sym"; v: string };

const COMPARISON_SYMBOLS = new Set(["=", "<>", "<", ">", "<=", ">="]);
const TYPE_NAME_CONTINUATIONS = new Set(["varying", "precision"]);
const RESERVED_WORDS = new Set(["and", "or", "not", "is", "null", "in"]);

type BoolAst =
  | { k: "op"; name: "and" | "or"; args: BoolAst[] }
  | { k: "not"; a: BoolAst }
  | { k: "leaf"; s: string };

class BoolExprParser {
  private pos = 0;

  constructor(private readonly tokens: BoolToken[]) {}

  private peek(): BoolToken | undefined {
    return this.tokens[this.pos];
  }

  private nextToken(): BoolToken | undefined {
    return this.tokens[this.pos++];
  }

  private peekId(value: string): boolean {
    const tok = this.peek();
    return tok?.t === "id" && tok.v === value;
  }

  private expectSym(value: string): void {
    const tok = this.nextToken();
    if (!tok || tok.t !== "sym" || tok.v !== value) {
      abort(`expected '${value}' in expression near token ${JSON.stringify(tok ?? "EOF")}`);
    }
  }

  expectEnd(): void {
    const tok = this.peek();
    if (tok) abort(`unexpected trailing token ${JSON.stringify(tok)} in expression`);
  }

  parseOr(): BoolAst {
    const args = [this.parseAnd()];
    while (this.peekId("or")) {
      this.nextToken();
      args.push(this.parseAnd());
    }
    const first = args[0];
    return args.length === 1 && first !== undefined ? first : { k: "op", name: "or", args };
  }

  private parseAnd(): BoolAst {
    const args = [this.parseNot()];
    while (this.peekId("and")) {
      this.nextToken();
      args.push(this.parseNot());
    }
    const first = args[0];
    return args.length === 1 && first !== undefined ? first : { k: "op", name: "and", args };
  }

  private parseNot(): BoolAst {
    if (this.peekId("not")) {
      this.nextToken();
      return { k: "not", a: this.parseNot() };
    }
    return this.parsePredicate();
  }

  private parsePredicate(): BoolAst {
    const lhs = this.parseOperandWithCasts();

    const tok = this.peek();
    if (tok?.t === "sym" && COMPARISON_SYMBOLS.has(tok.v)) {
      this.nextToken();
      // Postgres renders IN-lists as `<lhs> = ANY (ARRAY[...])`; unify both
      // spellings into one membership leaf.
      if ((tok.v === "=" || tok.v === "<>") && this.peekId("any")) {
        this.nextToken();
        const items = this.parseAnyParenthesizedList();
        return {
          k: "leaf",
          s: `(${tok.v === "=" ? "in" : "not-in"} ${lhs} ${items.sort().join(" ")})`,
        };
      }
      const rhs = this.parseOperandWithCasts();
      return { k: "leaf", s: `(${tok.v} ${lhs} ${rhs})` };
    }
    if (this.peekId("is")) {
      this.nextToken();
      let negated = false;
      if (this.peekId("not")) {
        this.nextToken();
        negated = true;
      }
      if (!this.peekId("null")) abort(`expected NULL after IS in expression`);
      this.nextToken();
      return { k: "leaf", s: `(${negated ? "is-not-null" : "is-null"} ${lhs})` };
    }
    if (
      this.peekId("in") ||
      (this.peekId("not") &&
        this.tokens[this.pos + 1]?.t === "id" &&
        this.tokens[this.pos + 1]?.v === "in")
    ) {
      let negated = false;
      const first = this.nextToken();
      if (first !== undefined && first.t === "id" && first.v === "not") {
        negated = true;
        this.nextToken(); // consume 'in'
      }
      this.expectSym("(");
      const items = this.parseExprListUntilCloseParen();
      return {
        k: "leaf",
        s: `(${negated ? "not-in" : "in"} ${lhs} ${items.sort().join(" ")})`,
      };
    }
    return { k: "leaf", s: lhs };
  }

  /** Parses `ANY (ARRAY['a', 'b'])` after the ANY keyword was consumed. */
  private parseAnyParenthesizedList(): string[] {
    this.expectSym("(");
    if (this.peekId("array")) {
      this.nextToken();
      this.expectSym("[");
      const items = this.parseExprListUntilCloseBracket();
      this.expectSym(")");
      return items;
    }
    return abort(`unsupported ANY() argument: only ARRAY[...] membership is handled`);
  }

  private parseExprListUntilCloseParen(): string[] {
    const items: string[] = [];
    for (;;) {
      items.push(this.parseOperandWithCasts());
      const tok = this.nextToken();
      if (!tok || tok.t !== "sym") abort(`expected ',' or ')' in list`);
      if (tok.v === ")") return items;
      if (tok.v !== ",") abort(`expected ',' or ')' but found '${tok.v}' in list`);
    }
  }

  /** Parses a primary operand, swallowing any trailing ::type casts. */
  private parseOperandWithCasts(): string {
    const operand = this.parseOperand();
    for (;;) {
      const tok = this.peek();
      if (tok?.t === "sym" && tok.v === "::") {
        this.nextToken();
        const typeTok = this.nextToken();
        if (!typeTok || typeTok.t !== "id") abort(`expected type name after '::'`);
        const second = this.peek();
        if (second?.t === "id" && TYPE_NAME_CONTINUATIONS.has(second.v)) this.nextToken();
        continue;
      }
      break;
    }
    return operand;
  }

  private parseOperand(): string {
    const tok = this.nextToken();
    if (!tok) abort(`unexpected end of expression`);
    if (tok.t === "str") return `'${tok.v}'`;
    if (tok.t === "num") return tok.v;
    if (tok.t === "sym" && tok.v === "(") {
      const inner = this.parseOr();
      this.expectSym(")");
      return renderBoolAst(inner);
    }
    if (tok.t === "sym" && tok.v === "[") {
      const items = this.parseExprListUntilCloseBracket();
      return `(array ${items.sort().join(" ")})`;
    }
    if (tok.t !== "id") abort(`unexpected token '${tok.v}' in expression`);
    if (RESERVED_WORDS.has(tok.v)) abort(`unexpected keyword '${tok.v}' as operand`);

    // Dotted identifiers: keep only the final segment -- pg_get_constraintdef
    // renders CHECK bodies unqualified, dropping any table prefix.
    let name = tok.v;
    while (this.peek()?.t === "sym" && this.peek()?.v === ".") {
      this.nextToken();
      const part = this.nextToken();
      if (!part || part.t !== "id") abort(`expected identifier after '.'`);
      name = part.v;
    }
    if (this.peek()?.t === "sym" && this.peek()?.v === "(") {
      this.nextToken();
      const items = this.parseExprListUntilCloseParen();
      return `(${name}${name === "any" ? "" : `-call`} ${items.join(" ")})`;
    }
    if (name === "array" && this.peek()?.t === "sym" && this.peek()?.v === "[") {
      this.nextToken();
      const items = this.parseExprListUntilCloseBracket();
      return `(array ${items.sort().join(" ")})`;
    }
    if (name === "null") return "(null)";
    return name;
  }

  private parseExprListUntilCloseBracket(): string[] {
    const items: string[] = [];
    for (;;) {
      items.push(this.parseOperandWithCasts());
      const tok = this.nextToken();
      if (!tok || tok.t !== "sym") abort(`expected ',' or ']' in array literal`);
      if (tok.v === "]") return items;
      if (tok.v !== ",") abort(`expected ',' or ']' but found '${tok.v}'`);
    }
  }
}

function tokenizeBoolExpr(text: string): BoolToken[] {
  const tokens: BoolToken[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "'") {
      const end = scanSingleQuoted(text, i);
      const content = text.slice(i + 1, Math.min(end, text.length) - 1);
      tokens.push({ t: "str", v: content });
      i = end;
    } else if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text.charAt(j))) j++;
      tokens.push({ t: "num", v: text.slice(i, j) });
      i = j;
    } else if (/[a-z_]/.test(ch)) {
      let j = i;
      while (j < text.length && /[a-z0-9_$]/.test(text.charAt(j))) j++;
      tokens.push({ t: "id", v: text.slice(i, j) });
      i = j;
    } else if (ch === ":" && text.charAt(i + 1) === ":") {
      tokens.push({ t: "sym", v: "::" });
      i += 2;
    } else if ("()[],.".includes(ch)) {
      tokens.push({ t: "sym", v: ch });
      i++;
    } else if (ch === "=" || ch === "<" || ch === ">") {
      const next = text[i + 1];
      if ((ch === "<" || ch === ">") && next === "=") {
        tokens.push({ t: "sym", v: `${ch}=` });
        i += 2;
      } else if (ch === "<" && next === ">") {
        tokens.push({ t: "sym", v: "<>" });
        i += 2;
      } else {
        tokens.push({ t: "sym", v: ch });
        i++;
      }
    } else {
      return abort(`untokenizable character '${ch}' in expression: ${text}`);
    }
  }
  return tokens;
}

function renderBoolAst(ast: BoolAst): string {
  if (ast.k === "leaf") return ast.s;
  if (ast.k === "not") return `(not ${renderBoolAst(ast.a)})`;
  const parts = ast.args.map(renderBoolAst).sort();
  return `(${ast.name} ${parts.join(" ")})`;
}

// ---------------------------------------------------------------------------
// Pure: statement classification -> probe derivation (fail-closed)
// ---------------------------------------------------------------------------

/**
 * SQL spellings whose information_schema.columns.data_type value is spelled
 * identically. Anything else aborts rather than guessing the catalog rendering.
 */
const ADD_COLUMN_DATA_TYPES = new Set([
  "text",
  "bytea",
  "date",
  "timestamp with time zone",
  "timestamp without time zone",
]);

/**
 * Derives one catalog assertion per SQL statement of a migration. Any statement
 * class that cannot be translated into an assertion throws AbortError listing
 * the statement -- a missing migration must never be marked applied blindly.
 *
 * `DROP CONSTRAINT IF EXISTS` produces no probe of its own: it is only accepted
 * when a later `ADD CONSTRAINT` in the same migration re-creates the constraint,
 * whose final definition is asserted instead.
 */
export function deriveProbes(tag: string, statements: string[]): Probe[] {
  const probes: Probe[] = [];
  const reAddedConstraints = new Set<string>();
  const pendingDrops: { name: string; statement: string }[] = [];

  for (const stmt of statements) {
    const createTable =
      /^create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)\s*\(/i.exec(
        stmt,
      );
    if (createTable) {
      const parts = parseQualifiedIdent(createTable[1] ?? "");
      probes.push({
        kind: "table",
        label: `table ${parts.join(".")}`,
        regclassInput: toRegclassName(parts),
      });
      continue;
    }

    if (/^create\s+(unique\s+)?index\b/i.test(stmt)) {
      probes.push(deriveIndexProbe(tag, stmt));
      continue;
    }

    const alterTable =
      /^alter\s+table\s+(?:only\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)\s+([^\s][\s\S]*)$/i.exec(
        stmt,
      );
    if (alterTable) {
      const tableName = parseQualifiedIdent(alterTable[1] ?? "");
      const rest = collapseDef(alterTable[2] ?? "");
      deriveAlterTableProbe(tag, stmt, tableName, rest, probes, pendingDrops, reAddedConstraints);
      continue;
    }

    return abort(
      `[${tag}] unhandled statement class -- refusing to reconcile:\n  ${stmt.slice(0, 200)}`,
    );
  }

  for (const drop of pendingDrops) {
    if (!reAddedConstraints.has(drop.name)) {
      return abort(
        `[${tag}] DROP CONSTRAINT IF EXISTS "${drop.name}" has no matching later ADD CONSTRAINT in the same migration; cannot verify:\n  ${drop.statement.slice(0, 200)}`,
      );
    }
  }
  return probes;
}

function deriveAlterTableProbe(
  tag: string,
  stmt: string,
  tableParts: string[],
  rest: string,
  probes: Probe[],
  pendingDrops: { name: string; statement: string }[],
  reAddedConstraints: Set<string>,
): void {
  const table = tableParts[tableParts.length - 1];
  if (!table) return abort(`[${tag}] ALTER TABLE without table name`);

  let m = /^add column (?:if not exists )?"?([a-z_][a-z0-9_]*)"? ([\s\S]+)$/.exec(rest);
  if (m) {
    probes.push(deriveAddColumnProbe(tag, stmt, table, m[1] ?? "", m[2] ?? ""));
    return;
  }

  m = /^alter column "?([a-z_][a-z0-9_]*)"? drop not null$/.exec(rest);
  if (m) {
    probes.push({
      kind: "drop-not-null",
      label: `column ${table}.${m[1]} is_nullable=YES`,
      table,
      column: m[1] ?? "",
    });
    return;
  }

  m = /^add constraint "?([a-z_][a-z0-9_]*)"? ([\s\S]+)$/.exec(rest);
  if (m) {
    const name = m[1] ?? "";
    const body = m[2] ?? "";
    reAddedConstraints.add(name);
    if (body.startsWith("check ")) {
      const checkBody = body.slice("check ".length);
      const inner = extractBalancedParens(checkBody);
      if (inner === null || !isOnlyWhitespaceAfter(checkBody, inner.end))
        return abort(`[${tag}] unsupported CHECK constraint syntax:\n  ${stmt.slice(0, 200)}`);
      probes.push({
        kind: "constraint-check",
        label: `constraint ${name} on ${table}`,
        table,
        name,
        canonicalBody: canonBooleanExpr(inner.content),
      });
      return;
    }
    if (body.startsWith("foreign key")) {
      probes.push(deriveForeignKeyProbe(tag, stmt, table, name, body));
      return;
    }
    return abort(
      `[${tag}] unhandled ADD CONSTRAINT form '${body.split(" ")[0]}' -- refusing to reconcile:\n  ${stmt.slice(0, 200)}`,
    );
  }

  m = /^drop constraint (?:if exists )?"?([a-z_][a-z0-9_]*)"?$/.exec(rest);
  if (m) {
    // Accepted only when paired with a later ADD CONSTRAINT of the same name;
    // verified by the post-pass in deriveProbes().
    pendingDrops.push({ name: m[1] ?? "", statement: stmt });
    return;
  }

  return abort(
    `[${tag}] unhandled ALTER TABLE form -- refusing to reconcile:\n  ${stmt.slice(0, 200)}`,
  );
}

function deriveAddColumnProbe(
  tag: string,
  stmt: string,
  table: string,
  column: string,
  typeRest: string,
): Probe {
  const tokens = tokenizeTopLevelWords(typeRest);
  const boundary = tokens.findIndex(
    (t, j) => t.word === "default" || (t.word === "not" && tokens[j + 1]?.word === "null"),
  );
  const typeTokens =
    boundary === -1 ? tokens : tokens.filter((t) => t.index < (tokens[boundary]?.index ?? 0));
  const dataTypeRaw = typeTokens
    .map((t) => t.word)
    .join(" ")
    .trim();
  if (!ADD_COLUMN_DATA_TYPES.has(dataTypeRaw)) {
    return abort(
      `[${tag}] unsupported ADD COLUMN type '${dataTypeRaw}' (no known information_schema.data_type mapping) -- refusing to reconcile`,
    );
  }
  let defaultExpr: string | null = null;
  let nullable = true;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    if (
      tok.word === "default" &&
      (boundary === -1 || tok.index >= (tokens[boundary]?.index ?? 0))
    ) {
      const nextBoundary = tokens.findIndex(
        (t, j) =>
          j > i &&
          ((t.word === "not" && tokens[j + 1]?.word === "null") ||
            t.word === "constraint" ||
            (t.word === "null" && tokens[j - 1]?.word !== "not")),
      );
      const endIdx = nextBoundary === -1 ? tokens.length : nextBoundary;
      defaultExpr = tokens
        .slice(i + 1, i + 1 + Math.max(0, endIdx - (i + 1)))
        .map((t) => t.raw)
        .join(" ")
        .trim();
      i = endIdx - 1;
    } else if (tok.word === "not" && tokens[i + 1]?.word === "null") {
      nullable = false;
      i++;
    } else if (tok.word === "null") {
      nullable = true;
    } else if (tok.word === "constraint") {
      return abort(
        `[${tag}] unsupported inline column CONSTRAINT -- refusing to reconcile:\n  ${stmt.slice(0, 200)}`,
      );
    }
  }
  return {
    kind: "column",
    label: `column ${table}.${column} (${dataTypeRaw}, ${nullable ? "nullable" : "not null"})`,
    table,
    column,
    dataType: dataTypeRaw,
    nullable,
    defaultExpr: defaultExpr === null || defaultExpr === "" ? null : defaultExpr,
  };
}

function deriveForeignKeyProbe(
  tag: string,
  stmt: string,
  table: string,
  name: string,
  body: string,
): Probe {
  const fk =
    /^foreign key \(([^)]+)\) references ([a-z_][a-z0-9_.]*?) ?\(([^)]+)\)(?: on delete ([a-z ]+?))?(?: on update ([a-z ]+?))?$/i.exec(
      body,
    );
  if (!fk) {
    return abort(
      `[${tag}] unhandled FOREIGN KEY syntax -- refusing to reconcile:\n  ${stmt.slice(0, 200)}`,
    );
  }
  const normalizeAction = (action: string | undefined): string | null => {
    if (action === undefined) return null;
    const cleaned = action.trim();
    if (cleaned === "no action") return null; // Postgres omits the default
    if (!["cascade", "restrict", "set null", "set default"].includes(cleaned)) {
      return abort(`[${tag}] unsupported FK action '${cleaned}'`);
    }
    return cleaned;
  };
  return {
    kind: "constraint-fk",
    label: `constraint ${name} on ${table} (foreign key)`,
    table,
    name,
    columns: splitIdentList(fk[1] ?? ""),
    refTable: lastSegment(collapseDef(fk[2] ?? "")),
    refColumns: splitIdentList(fk[3] ?? ""),
    onDelete: normalizeAction(fk[4]),
    onUpdate: normalizeAction(fk[5]),
  };
}

function deriveIndexProbe(tag: string, stmt: string): Probe {
  const head =
    /^create\s+(unique\s+)?index\s+(?:if\s+not\s+exists\s+)?("?([a-z_][a-z0-9_]*)"?)\s+on\s+((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)/i.exec(
      stmt,
    );
  if (!head) {
    return abort(
      `[${tag}] unhandled CREATE INDEX syntax -- refusing to reconcile:\n  ${stmt.slice(0, 200)}`,
    );
  }
  let rest = collapseDef(stmt.slice(head.index + head[0].length));
  let method = "btree";
  const using = /^using (\w+) /.exec(rest);
  if (using) {
    method = using[1] ?? "";
    rest = rest.slice(using[0].length);
  }
  if (method !== "btree") {
    return abort(`[${tag}] unsupported index method '${method}' -- refusing to reconcile`);
  }
  if (!rest.startsWith("(")) {
    return abort(
      `[${tag}] malformed CREATE INDEX column list -- refusing to reconcile:\n  ${stmt.slice(0, 200)}`,
    );
  }
  const colsBlock = extractBalancedParens(rest);
  if (!colsBlock) {
    return abort(
      `[${tag}] malformed CREATE INDEX column list -- refusing to reconcile:\n  ${stmt.slice(0, 200)}`,
    );
  }
  const columns = splitIdentList(colsBlock.content);
  for (const col of columns) {
    if (!/^[a-z_][a-z0-9_]*$/.test(col)) {
      return abort(
        `[${tag}] unsupported expression column '${col}' in CREATE INDEX -- refusing to reconcile`,
      );
    }
  }
  const tail = rest.slice(colsBlock.end).trim();
  let canonicalWhere: string | null = null;
  if (tail.length > 0) {
    const where = /^where ([\s\S]+)$/.exec(tail);
    if (!where) {
      return abort(
        `[${tag}] unsupported CREATE INDEX clause '${tail.slice(0, 60)}' (INCLUDE/WITH/TABLESPACE are not handled) -- refusing to reconcile`,
      );
    }
    canonicalWhere = canonBooleanExpr(where[1] ?? "");
  }
  return {
    kind: "index",
    label: `index ${head[3] ?? ""}`,
    name: head[3] ?? "",
    unique: head[1] !== undefined,
    tableName: lastSegment(collapseDef(head[4] ?? "")),
    method,
    columns,
    canonicalWhere,
  };
}

// --- small parsing utilities -------------------------------------------------

interface TopLevelWord {
  word: string;
  raw: string;
  index: number;
}

/** Splits into lowercase words at whitespace boundaries, quote-aware. */
function tokenizeTopLevelWords(text: string): TopLevelWord[] {
  const tokens: TopLevelWord[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text.charAt(i))) {
      i++;
      continue;
    }
    const start = i;
    const ch = text.charAt(i);
    if (ch === "'") {
      i = scanSingleQuoted(text, i);
    } else if (ch === '"') {
      i = scanDoubleQuoted(text, i);
    } else if (ch === "(") {
      i = skipBalancedParens(text, i);
    } else {
      while (i < text.length && !/\s/.test(text.charAt(i))) i++;
    }
    const raw = text.slice(start, i);
    tokens.push({ word: raw.toLowerCase(), raw, index: start });
  }
  return tokens;
}

function skipBalancedParens(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "'") {
      i = scanSingleQuoted(text, i);
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** Extracts the contents of the first balanced paren group starting at index 0. */
function extractBalancedParens(text: string): { content: string; end: number } | null {
  let i = 0;
  while (i < text.length && /\s/.test(text.charAt(i))) i++;
  if (text.charAt(i) !== "(") return null;
  let depth = 0;
  const startContent = i + 1;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "'") {
      i = scanSingleQuoted(text, i);
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return { content: text.slice(startContent, i).trim(), end: i + 1 };
    }
    i++;
  }
  return null;
}

function isOnlyWhitespaceAfter(text: string, from: number): boolean {
  return text.slice(from).trim().length === 0;
}

function parseQualifiedIdent(text: string): string[] {
  return text.split(".").map((part) => part.trim().replace(/^"/, "").replace(/"$/, ""));
}

function toRegclassName(parts: string[]): string {
  const qualified = parts.length === 1 ? ["public", ...parts] : parts;
  return qualified.map((p) => `"${p.replace(/"/g, '""')}"`).join(".");
}

function splitIdentList(text: string): string[] {
  return text
    .split(",")
    .map((part) => lastSegment(part.trim()))
    .filter((part) => part.length > 0);
}

function lastSegment(ident: string): string {
  return ident.includes(".") ? (ident.split(".").pop() ?? "") : ident;
}

// ---------------------------------------------------------------------------
// Pure: reconciliation planning (watermark + ambiguity rules)
// ---------------------------------------------------------------------------

export type EntryStatus = "insert" | "skip-below-watermark" | "already-present";

export interface ReconciliationPlan {
  watermark: number | null;
  perEntry: { entry: JournalEntry; status: EntryStatus }[];
  inserts: JournalEntry[];
}

/**
 * Decides, purely from journal + tracking rows, what must happen. Throws
 * AbortError on any ambiguity (requirement: human decision, never a guess):
 * - duplicate stored hashes
 * - stored hashes absent from the journal
 * - an entry with when <= watermark whose hash is not tracked
 */
export function planReconciliation(
  entries: JournalEntry[],
  rows: TrackingRow[],
): ReconciliationPlan {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.hash, (counts.get(row.hash) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([h]) => h);
  if (duplicates.length > 0) {
    abort(`duplicate tracking rows for hash(es): ${duplicates.join(", ")}`);
  }
  const journalHashes = new Set(entries.map((e) => e.hash));
  const unknownHashes = [...rows.filter((r) => !journalHashes.has(r.hash)).map((r) => r.hash)];
  if (unknownHashes.length > 0) {
    abort(`tracking table holds hashes absent from the journal: ${unknownHashes.join(", ")}`);
  }
  const watermark = rows.length > 0 ? Math.max(...rows.map((r) => r.createdAt)) : null;

  const perEntry: { entry: JournalEntry; status: EntryStatus }[] = [];
  const inserts: JournalEntry[] = [];
  for (const entry of entries) {
    const tracked = counts.has(entry.hash);
    if (!tracked && watermark !== null && entry.when <= watermark) {
      abort(
        `[${entry.tag}] when=${String(entry.when)} <= watermark=${String(watermark)} but no tracking row exists -- historical inconsistency; refusing to backfill`,
      );
    }
    if (tracked) {
      perEntry.push({
        entry,
        status:
          watermark !== null && entry.when <= watermark
            ? "skip-below-watermark"
            : "already-present",
      });
    } else {
      perEntry.push({ entry, status: "insert" });
      inserts.push(entry);
    }
  }
  return { watermark, perEntry, inserts };
}

// ---------------------------------------------------------------------------
// Pure: probe evaluation against captured catalog renderings
// ---------------------------------------------------------------------------

export interface ProbeOutcome {
  ok: boolean;
  detail: string;
}

const MISSING_OBJECT = "object not found in catalog";

/** Evaluates information_schema.columns row for column/drop-not-null probes. */
export function evaluateColumnRow(
  probe: Extract<Probe, { kind: "column" | "drop-not-null" }>,
  row:
    | {
        data_type: string | null;
        is_nullable: string | null;
        column_default: string | null;
      }
    | undefined,
): ProbeOutcome {
  if (!row || row.data_type === null) {
    return { ok: false, detail: `${probe.table}.${probe.column}: ${MISSING_OBJECT}` };
  }
  if (probe.kind === "drop-not-null") {
    return row.is_nullable === "YES"
      ? { ok: true, detail: `${probe.label} -- confirmed` }
      : {
          ok: false,
          detail: `${probe.table}.${probe.column}: is_nullable=${String(row.is_nullable)}, expected YES`,
        };
  }
  if (row.data_type !== probe.dataType) {
    return {
      ok: false,
      detail: `${probe.table}.${probe.column}: data_type='${row.data_type}', expected '${probe.dataType}'`,
    };
  }
  const actualNullable = row.is_nullable === "YES";
  if (actualNullable !== probe.nullable) {
    return {
      ok: false,
      detail: `${probe.table}.${probe.column}: is_nullable='${String(row.is_nullable)}', expected ${probe.nullable ? "YES" : "NO"}`,
    };
  }
  const actualDefault = normalizeDefaultExpr(row.column_default);
  const expectedDefault = normalizeDefaultExpr(probe.defaultExpr);
  if (actualDefault !== expectedDefault) {
    return {
      ok: false,
      detail: `${probe.table}.${probe.column}: default '${String(row.column_default)}', expected '${String(probe.defaultExpr)}'`,
    };
  }
  return { ok: true, detail: `${probe.label} -- confirmed` };
}

/** Evaluates pg_get_constraintdef output against a CHECK probe. */
export function evaluateCheckDef(
  probe: Extract<Probe, { kind: "constraint-check" }>,
  def: string | undefined,
): ProbeOutcome {
  if (!def) {
    return { ok: false, detail: `constraint ${probe.name} on ${probe.table}: ${MISSING_OBJECT}` };
  }
  const body = extractBalancedParens(def.slice(def.toLowerCase().indexOf("check") + 5));
  if (!body) {
    return { ok: false, detail: `constraint ${probe.name}: unparseable definition '${def}'` };
  }
  const actualCanonical = canonBooleanExpr(body.content);
  return actualCanonical === probe.canonicalBody
    ? { ok: true, detail: `${probe.label} -- confirmed` }
    : {
        ok: false,
        detail: `constraint ${probe.name}: definition mismatch\n    expected: ${probe.canonicalBody}\n    actual:   ${actualCanonical}`,
      };
}

/** Evaluates pg_get_constraintdef output against a FOREIGN KEY probe. */
export function evaluateFkDef(
  probe: Extract<Probe, { kind: "constraint-fk" }>,
  def: string | undefined,
): ProbeOutcome {
  if (!def) {
    return { ok: false, detail: `constraint ${probe.name} on ${probe.table}: ${MISSING_OBJECT}` };
  }
  const collapsed = collapseDef(def);
  const m =
    /^foreign key \(([^)]*)\) references ([^(]+?) ?\(([^)]*)\)(?: on delete ([a-z ]+?))?(?: on update ([a-z ]+?))?$/i.exec(
      collapsed,
    );
  if (!m) {
    return { ok: false, detail: `constraint ${probe.name}: unparseable FK definition '${def}'` };
  }
  const normalizeAction = (action: string | undefined): string =>
    action === undefined ? "" : action.trim() === "no action" ? "" : action.trim();
  const diffs: string[] = [];
  const actualColumns = splitIdentList(m[1] ?? "");
  const actualRefTable = lastSegment(collapseDef(m[2] ?? ""));
  const actualRefColumns = splitIdentList(m[3] ?? "");
  const actualOnDelete = normalizeAction(m[4]);
  const actualOnUpdate = normalizeAction(m[5]);
  if (actualColumns.join(",") !== probe.columns.join(",")) {
    diffs.push(`columns [${actualColumns.join(", ")}] != [${probe.columns.join(", ")}]`);
  }
  if (actualRefTable !== probe.refTable) {
    diffs.push(`references ${actualRefTable} != ${probe.refTable}`);
  }
  if (actualRefColumns.join(",") !== probe.refColumns.join(",")) {
    diffs.push(`ref columns [${actualRefColumns.join(", ")}] != [${probe.refColumns.join(", ")}]`);
  }
  if (actualOnDelete !== (probe.onDelete ?? "")) {
    diffs.push(`on delete '${actualOnDelete}' != '${probe.onDelete ?? "(default)"}'`);
  }
  if (actualOnUpdate !== (probe.onUpdate ?? "")) {
    diffs.push(`on update '${actualOnUpdate}' != '${probe.onUpdate ?? "(default)"}'`);
  }
  return diffs.length === 0
    ? { ok: true, detail: `${probe.label} -- confirmed` }
    : { ok: false, detail: `constraint ${probe.name}: ${diffs.join("; ")}` };
}

/** Evaluates pg_indexes.indexdef output against an index probe. */
export function evaluateIndexdef(
  probe: Extract<Probe, { kind: "index" }>,
  indexdef: string | undefined,
): ProbeOutcome {
  if (!indexdef) {
    return { ok: false, detail: `index ${probe.name}: ${MISSING_OBJECT}` };
  }
  const collapsed = collapseDef(indexdef);
  const m =
    /^create (unique )?index ([a-z_][a-z0-9_$]*) on ([^(]+?) using (\w+) ?\(([^)]*)\)(?: where ([\s\S]+))?$/i.exec(
      collapsed,
    );
  if (!m) {
    return { ok: false, detail: `index ${probe.name}: unparseable indexdef '${indexdef}'` };
  }
  const diffs: string[] = [];
  const actualUnique = Boolean(m[1]);
  const actualTable = lastSegment(m[3] ?? "");
  const actualMethod = (m[4] ?? "").toLowerCase();
  const actualColumns = splitIdentList(m[5] ?? "");
  const actualWhereCanon =
    m[6] === undefined || m[6] === "" ? null : canonBooleanExpr(collapseDef(m[6]));
  if (actualUnique !== probe.unique)
    diffs.push(`unique=${String(actualUnique)} != ${String(probe.unique)}`);
  if (actualTable !== probe.tableName) diffs.push(`table ${actualTable} != ${probe.tableName}`);
  if (actualMethod !== probe.method) diffs.push(`method ${actualMethod} != ${probe.method}`);
  if (actualColumns.join(",") !== probe.columns.join(",")) {
    diffs.push(`columns [${actualColumns.join(", ")}] != [${probe.columns.join(", ")}]`);
  }
  if ((actualWhereCanon ?? "") !== (probe.canonicalWhere ?? "")) {
    diffs.push(
      `where clause differs\n    expected: ${probe.canonicalWhere ?? "(none)"}\n    actual:   ${actualWhereCanon ?? "(none)"}`,
    );
  }
  return diffs.length === 0
    ? { ok: true, detail: `${probe.label} -- confirmed` }
    : { ok: false, detail: `index ${probe.name}: ${diffs.join("; ")}` };
}

// ---------------------------------------------------------------------------
// Impure: database orchestration
// ---------------------------------------------------------------------------

/** Read-only catalog queries, one per probe assertion. */
export function probeQuery(probe: Probe): { text: string; values: string[] } {
  switch (probe.kind) {
    case "table":
      return { text: "SELECT to_regclass($1) AS reg", values: [probe.regclassInput] };
    case "column":
    case "drop-not-null":
      return {
        text:
          "SELECT data_type, is_nullable, column_default FROM information_schema.columns " +
          "WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2",
        values: [probe.table, probe.column],
      };
    case "constraint-check":
    case "constraint-fk":
      return {
        text:
          "SELECT pg_get_constraintdef(c.oid, true) AS def FROM pg_constraint c " +
          "JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace " +
          "WHERE n.nspname = current_schema() AND r.relname = $1 AND c.conname = $2",
        values: [probe.table, probe.name],
      };
    case "index":
      return {
        text: "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1",
        values: [probe.name],
      };
  }
}

async function runProbe(client: PoolClient, probe: Probe): Promise<ProbeOutcome> {
  const q = probeQuery(probe);
  const result = await client.query<Record<string, string | null>>(q.text, q.values);
  const row = result.rows[0];
  switch (probe.kind) {
    case "table":
      return row !== undefined && row["reg"] !== null
        ? { ok: true, detail: `${probe.label} -- confirmed` }
        : { ok: false, detail: `${probe.label}: ${MISSING_OBJECT}` };
    case "column":
    case "drop-not-null":
      return evaluateColumnRow(
        probe,
        row as
          | {
              data_type: string | null;
              is_nullable: string | null;
              column_default: string | null;
            }
          | undefined,
      );
    case "constraint-check":
      return evaluateCheckDef(probe, row?.["def"] ?? undefined);
    case "constraint-fk":
      return evaluateFkDef(probe, row?.["def"] ?? undefined);
    case "index":
      return evaluateIndexdef(probe, row?.["indexdef"] ?? undefined);
  }
}

async function readTrackingRows(client: PoolClient): Promise<TrackingRow[]> {
  try {
    const result = await client.query<{ id: number | string; hash: string; created_at: string }>(
      "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
    );
    return result.rows.map((row) => {
      const createdAtRaw = String(row.created_at);
      return { id: Number(row.id), hash: row.hash, createdAtRaw, createdAt: Number(createdAtRaw) };
    });
  } catch (err) {
    return abort(
      `cannot read drizzle.__drizzle_migrations: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function reconcileInTransaction(
  client: PoolClient,
  entries: JournalEntry[],
  plannedInserts: JournalEntry[],
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [RECONCILE_ADVISORY_LOCK_KEY]);
    // Re-read the watermark INSIDE the transaction, immediately before any
    // insert: drizzle-kit migrate or a concurrent reconciler may have written
    // rows between the probes above and now. Abort on any drift.
    const freshRows = await readTrackingRows(client);
    const freshPlan = planReconciliation(entries, freshRows);
    const freshHashes = new Set(freshPlan.inserts.map((e) => e.hash));
    const plannedHashes = new Set(plannedInserts.map((e) => e.hash));
    if (
      freshHashes.size !== plannedHashes.size ||
      [...plannedHashes].some((hash) => !freshHashes.has(hash))
    ) {
      return abort("tracking state changed concurrently between probe and insert -- rerun");
    }
    for (const entry of freshPlan.inserts) {
      // INVARIANT: created_at must be journal.when (the migrator's folderMillis),
      // NEVER Date.now() -- production parity depends on exact journal values.
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)',
        [entry.hash, String(entry.when)],
      );
      console.log(`[${entry.tag}] INSERTED (${entry.hash.slice(0, 12)}..., ${String(entry.when)})`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

function printSummary(plan: ReconciliationPlan): void {
  let skipped = 0;
  let alreadyPresent = 0;
  for (const { status } of plan.perEntry) {
    if (status === "skip-below-watermark") skipped++;
    if (status === "already-present") alreadyPresent++;
  }
  console.log(
    `summary: ${plan.inserts.length} reconciled, ${skipped} skipped, ${alreadyPresent} already-present`,
  );
}

async function run(mode: "check" | "reconcile"): Promise<number> {
  const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
  const entries = loadJournalEntries(migrationsFolder);

  // Expected migrator role is derived from the connection URL's userinfo -- no
  // hardcoded role names anywhere in this file.
  const urlString = process.env["MIGRATIONS_DATABASE_URL"];
  if (urlString === undefined || urlString.trim() === "") {
    console.error("MIGRATIONS_DATABASE_URL is not set");
    return 2;
  }
  let dbUrl: URL;
  try {
    dbUrl = new URL(urlString);
  } catch {
    console.error("MIGRATIONS_DATABASE_URL is not a valid URL");
    return 2;
  }
  const expectedUser = decodeURIComponent(dbUrl.username);
  const expectedDatabase = decodeURIComponent(dbUrl.pathname.replace(/^\/+/, "")).replace(
    /\/+$/,
    "",
  );
  if (expectedUser === "" || expectedDatabase === "") {
    console.error("MIGRATIONS_DATABASE_URL must carry both a user and a database name");
    return 2;
  }

  // The least-privilege runtime app role must never run reconciliation DDL tooling.
  const runtimeUrlString = process.env["DATABASE_URL"];
  if (runtimeUrlString !== undefined && runtimeUrlString.trim() !== "") {
    try {
      if (decodeURIComponent(new URL(runtimeUrlString).username) === expectedUser) {
        console.error(
          `ABORT: MIGRATIONS_DATABASE_URL names role '${expectedUser}', which DATABASE_URL also names -- that is the runtime app role; refusing to reconcile`,
        );
        return 1;
      }
    } catch {
      // A malformed DATABASE_URL elsewhere in the environment is not ours to fix.
    }
  }

  const pool = new Pool({ connectionString: urlString, max: 1, connectionTimeoutMillis: 3000 });
  try {
    const client = await pool.connect();
    try {
      const identity = await client.query<{
        current_user: string;
        current_database: string;
      }>("SELECT current_user, current_database()");
      const actualUser = identity.rows[0]?.current_user ?? "";
      const actualDatabase = identity.rows[0]?.current_database ?? "";
      if (actualUser !== expectedUser) {
        return abort(
          `connected as '${actualUser}' but MIGRATIONS_DATABASE_URL userinfo names '${expectedUser}'`,
        );
      }
      if (actualDatabase !== expectedDatabase) {
        return abort(
          `connected to database '${actualDatabase}' but MIGRATIONS_DATABASE_URL names '${expectedDatabase}'`,
        );
      }

      const preRows = await readTrackingRows(client);
      const plan = planReconciliation(entries, preRows);

      console.log(
        `reconcile-drizzle-tracking mode=${mode} user=${actualUser} database=${actualDatabase}`,
      );
      console.log(
        `journal=${String(entries.length)} tracking-rows=${String(preRows.length)} watermark=${plan.watermark === null ? "none" : String(plan.watermark)}`,
      );

      // Probes BEFORE any insert (fail-closed): every statement of every missing
      // migration must be verified against the live catalog first.
      const failures: string[] = [];
      for (const { entry, status } of plan.perEntry) {
        if (status === "skip-below-watermark") {
          console.log(`[${entry.tag}] SKIP below-watermark`);
          continue;
        }
        if (status === "already-present") {
          console.log(`[${entry.tag}] ALREADY PRESENT`);
          continue;
        }
        const probes = deriveProbes(entry.tag, entry.statements);
        let passed = 0;
        for (const probe of probes) {
          const outcome = await runProbe(client, probe);
          if (outcome.ok) passed++;
          else failures.push(`[${entry.tag}] ${outcome.detail}`);
          console.log(`[${entry.tag}]   ${outcome.ok ? "ok  " : "FAIL"} ${outcome.detail}`);
        }
        console.log(`[${entry.tag}] PROBE ${String(passed)}/${String(probes.length)} ok`);
      }

      if (failures.length > 0) {
        console.error(
          `ABORT: ${String(failures.length)} catalog probe(s) failed -- refusing to mark anything applied:`,
        );
        for (const failure of failures) console.error(`  ${failure}`);
        return 1;
      }

      printSummary(plan);

      if (mode === "check") {
        if (plan.inserts.length > 0) {
          console.log(
            `--check: reconciliation needed (${plan.inserts.map((e) => e.tag).join(", ")})`,
          );
          return 1;
        }
        console.log("--check: tracking table consistent with journal");
        return 0;
      }

      if (plan.inserts.length > 0) {
        await reconcileInTransaction(client, entries, plan.inserts);
      } else {
        console.log("nothing to reconcile");
      }
      return 0;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let mode: "check" | "reconcile";
  if (args.length === 0) {
    mode = "reconcile";
  } else if (args.length === 1 && args[0] === "--check") {
    mode = "check";
  } else {
    console.error("usage: tsx scripts/reconcile-drizzle-tracking.ts [--check]");
    process.exitCode = 2;
    return;
  }
  try {
    process.exitCode = await run(mode);
  } catch (err) {
    if (err instanceof AbortError) {
      console.error(`ABORT: ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  });
}
