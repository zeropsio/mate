/**
 * The MCP servers of a TOML config (Codex's and Grok's `config.toml`), read
 * and edited in place.
 *
 * Not a general TOML library: it scans the whole file so it knows where every
 * table and key sits, but it only ever builds values for the server tables
 * under one root key (`mcp_servers`), and every edit splices text. The rest of
 * a hand-edited file — comments, order, spacing, tables it does not read —
 * stays byte for byte.
 *
 * @module mcpToml
 */

/** A plain value as a server table holds it: numbers and dates keep their source text. */
export type TomlPlain =
  | string
  | boolean
  | ReadonlyArray<TomlPlain>
  | { readonly [key: string]: TomlPlain };

type TomlValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "raw"; readonly raw: string }
  | { readonly kind: "array"; readonly items: ReadonlyArray<TomlValue> }
  | { readonly kind: "table"; readonly entries: Map<string, TomlValue> };

export class TomlSyntaxError extends Error {
  readonly line: number;
  constructor(line: number, detail: string) {
    super(`TOML line ${line}: ${detail}`);
    this.name = "TomlSyntaxError";
    this.line = line;
  }
}

interface HeaderItem {
  readonly kind: "header";
  readonly path: ReadonlyArray<string>;
  readonly array: boolean;
  /** The header line, its newline included. */
  readonly start: number;
  readonly end: number;
}

interface KeyValueItem {
  readonly kind: "kv";
  /** The table the key sits in, as its header names it. */
  readonly table: ReadonlyArray<string>;
  readonly inArrayTable: boolean;
  readonly key: ReadonlyArray<string>;
  readonly value: TomlValue;
  readonly start: number;
  readonly end: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

type Item = HeaderItem | KeyValueItem;

const BARE_KEY = /[A-Za-z0-9_-]+/y;
const RAW_VALUE = /[^,\]}\s#][^,\]}#\r\n]*/y;

class Scanner {
  pos = 0;
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }

  fail(detail: string): never {
    const line = this.text.slice(0, this.pos).split("\n").length;
    throw new TomlSyntaxError(line, detail);
  }

  peek(offset = 0): string | undefined {
    return this.text[this.pos + offset];
  }

  startsWith(token: string): boolean {
    return this.text.startsWith(token, this.pos);
  }

  skipSpaces(): void {
    while (this.peek() === " " || this.peek() === "\t") this.pos += 1;
  }

  skipComment(): void {
    if (this.peek() !== "#") return;
    while (this.pos < this.text.length && this.peek() !== "\n") this.pos += 1;
  }

  /** Inside an array or inline table: spaces, newlines and comments. */
  skipBlank(): void {
    for (;;) {
      this.skipSpaces();
      if (this.peek() === "#") this.skipComment();
      else if (this.peek() === "\n") this.pos += 1;
      else if (this.startsWith("\r\n")) this.pos += 2;
      else return;
    }
  }

  /** The rest of an item's line: spaces, a comment, the newline. */
  endLine(): void {
    this.skipSpaces();
    this.skipComment();
    if (this.pos >= this.text.length) return;
    if (this.peek() === "\n") this.pos += 1;
    else if (this.startsWith("\r\n")) this.pos += 2;
    else this.fail(`unexpected "${this.peek()}"`);
  }

  key(): ReadonlyArray<string> {
    const parts = [this.simpleKey()];
    for (;;) {
      this.skipSpaces();
      if (this.peek() !== ".") return parts;
      this.pos += 1;
      this.skipSpaces();
      parts.push(this.simpleKey());
    }
  }

  simpleKey(): string {
    if (this.peek() === '"') return this.basicString();
    if (this.peek() === "'") return this.literalString();
    BARE_KEY.lastIndex = this.pos;
    const match = BARE_KEY.exec(this.text);
    if (match === null) this.fail("expected a key");
    this.pos += match[0].length;
    return match[0];
  }

  value(): TomlValue {
    if (this.startsWith('"""')) return { kind: "string", value: this.multilineBasicString() };
    if (this.startsWith("'''")) return { kind: "string", value: this.multilineLiteralString() };
    if (this.peek() === '"') return { kind: "string", value: this.basicString() };
    if (this.peek() === "'") return { kind: "string", value: this.literalString() };
    if (this.peek() === "[") return this.array();
    if (this.peek() === "{") return this.inlineTable();
    for (const word of ["true", "false"] as const) {
      if (this.startsWith(word) && !/[A-Za-z0-9_-]/.test(this.peek(word.length) ?? "")) {
        this.pos += word.length;
        return { kind: "boolean", value: word === "true" };
      }
    }
    RAW_VALUE.lastIndex = this.pos;
    const match = RAW_VALUE.exec(this.text);
    if (match === null) this.fail("expected a value");
    this.pos += match[0].length;
    return { kind: "raw", raw: match[0].trimEnd() };
  }

  array(): TomlValue {
    this.pos += 1;
    const items: TomlValue[] = [];
    for (;;) {
      this.skipBlank();
      if (this.peek() === "]") break;
      items.push(this.value());
      this.skipBlank();
      if (this.peek() === ",") this.pos += 1;
      else if (this.peek() !== "]") this.fail("expected , or ] in an array");
    }
    this.pos += 1;
    return { kind: "array", items };
  }

  inlineTable(): TomlValue {
    this.pos += 1;
    const table: TomlValue = { kind: "table", entries: new Map() };
    for (;;) {
      this.skipBlank();
      if (this.peek() === "}") break;
      const key = this.key();
      this.skipSpaces();
      if (this.peek() !== "=") this.fail("expected = in an inline table");
      this.pos += 1;
      this.skipSpaces();
      setPath(table, key, this.value());
      this.skipBlank();
      if (this.peek() === ",") this.pos += 1;
      else if (this.peek() !== "}") this.fail("expected , or } in an inline table");
    }
    this.pos += 1;
    return table;
  }

  basicString(): string {
    this.pos += 1;
    let out = "";
    for (;;) {
      const char = this.peek();
      if (char === undefined || char === "\n") this.fail("unterminated string");
      if (char === '"') {
        this.pos += 1;
        return out;
      }
      if (char === "\\") out += this.escape();
      else {
        out += char;
        this.pos += 1;
      }
    }
  }

  multilineBasicString(): string {
    this.pos += 3;
    if (this.peek() === "\n") this.pos += 1;
    else if (this.startsWith("\r\n")) this.pos += 2;
    let out = "";
    for (;;) {
      if (this.pos >= this.text.length) this.fail("unterminated string");
      if (this.startsWith('"""')) {
        let quotes = 3;
        while (this.peek(quotes) === '"' && quotes < 5) quotes += 1;
        out += '"'.repeat(quotes - 3);
        this.pos += quotes;
        return out;
      }
      if (this.peek() === "\\") {
        const rest = /\\[ \t]*\r?\n/y;
        rest.lastIndex = this.pos;
        if (rest.test(this.text)) {
          this.pos = rest.lastIndex;
          while (/[ \t\r\n]/.test(this.peek() ?? "")) this.pos += 1;
          continue;
        }
        out += this.escape();
        continue;
      }
      out += this.peek();
      this.pos += 1;
    }
  }

  literalString(): string {
    const end = this.text.indexOf("'", this.pos + 1);
    const newline = this.text.indexOf("\n", this.pos + 1);
    if (end === -1 || (newline !== -1 && newline < end)) this.fail("unterminated string");
    const out = this.text.slice(this.pos + 1, end);
    this.pos = end + 1;
    return out;
  }

  multilineLiteralString(): string {
    let start = this.pos + 3;
    if (this.text[start] === "\n") start += 1;
    else if (this.text.startsWith("\r\n", start)) start += 2;
    const end = this.text.indexOf("'''", start);
    if (end === -1) this.fail("unterminated string");
    let close = end + 3;
    while (this.text[close] === "'" && close - end < 5) close += 1;
    this.pos = close;
    return this.text.slice(start, close - 3);
  }

  escape(): string {
    const code = this.peek(1);
    const simple: Record<string, string> = {
      b: "\b",
      t: "\t",
      n: "\n",
      f: "\f",
      r: "\r",
      e: "\u001b",
      '"': '"',
      "\\": "\\",
    };
    if (code !== undefined && code in simple) {
      this.pos += 2;
      return simple[code]!;
    }
    const width = code === "u" ? 4 : code === "U" ? 8 : code === "x" ? 2 : 0;
    const hex = this.text.slice(this.pos + 2, this.pos + 2 + width);
    if (width === 0 || !new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) {
      this.fail("invalid escape");
    }
    this.pos += 2 + width;
    return String.fromCodePoint(Number.parseInt(hex, 16));
  }
}

function setPath(table: TomlValue, path: ReadonlyArray<string>, value: TomlValue): void {
  if (table.kind !== "table") return;
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    const existing = table.entries.get(head);
    if (existing?.kind === "table" && value.kind === "table") {
      for (const [key, inner] of value.entries) existing.entries.set(key, inner);
    } else {
      table.entries.set(head, value);
    }
    return;
  }
  let next = table.entries.get(head);
  if (next?.kind !== "table") {
    next = { kind: "table", entries: new Map() };
    table.entries.set(head, next);
  }
  setPath(next, rest, value);
}

function scan(text: string): ReadonlyArray<Item> {
  const scanner = new Scanner(text);
  const items: Item[] = [];
  let table: ReadonlyArray<string> = [];
  let inArrayTable = false;
  while (scanner.pos < text.length) {
    const start = scanner.pos;
    scanner.skipSpaces();
    const char = scanner.peek();
    if (char === undefined) break;
    if (char === "\n" || char === "\r" || char === "#") {
      scanner.endLine();
      continue;
    }
    if (char === "[") {
      const array = scanner.peek(1) === "[";
      scanner.pos += array ? 2 : 1;
      scanner.skipSpaces();
      const path = scanner.key();
      scanner.skipSpaces();
      if (!scanner.startsWith(array ? "]]" : "]")) scanner.fail("unclosed table header");
      scanner.pos += array ? 2 : 1;
      scanner.endLine();
      items.push({ kind: "header", path, array, start, end: scanner.pos });
      table = path;
      inArrayTable = array;
      continue;
    }
    const key = scanner.key();
    scanner.skipSpaces();
    if (scanner.peek() !== "=") scanner.fail("expected =");
    scanner.pos += 1;
    scanner.skipSpaces();
    if (scanner.peek() === "\n" || scanner.peek() === undefined || scanner.peek() === "#") {
      scanner.fail("a key without a value");
    }
    const valueStart = scanner.pos;
    const value = scanner.value();
    const valueEnd = scanner.pos;
    scanner.endLine();
    items.push({
      kind: "kv",
      table,
      inArrayTable,
      key,
      value,
      start,
      end: scanner.pos,
      valueStart,
      valueEnd,
    });
  }
  return items;
}

const startsWithPath = (path: ReadonlyArray<string>, prefix: ReadonlyArray<string>): boolean =>
  prefix.every((part, index) => path[index] === part);

const fullPath = (item: KeyValueItem): ReadonlyArray<string> => [...item.table, ...item.key];

function serverValues(items: ReadonlyArray<Item>, root: string): Map<string, TomlValue> {
  const servers = new Map<string, TomlValue>();
  const serverTable = (name: string): TomlValue => {
    let table = servers.get(name);
    if (table === undefined) {
      table = { kind: "table", entries: new Map() };
      servers.set(name, table);
    }
    return table;
  };
  for (const item of items) {
    if (item.kind === "header") {
      if (!item.array && item.path[0] === root && item.path.length >= 2) {
        let table = serverTable(item.path[1]!);
        for (const part of item.path.slice(2)) {
          if (table.kind !== "table") break;
          let next = table.entries.get(part);
          if (next?.kind !== "table") {
            next = { kind: "table", entries: new Map() };
            table.entries.set(part, next);
          }
          table = next;
        }
      }
      continue;
    }
    if (item.inArrayTable) continue;
    const path = fullPath(item);
    if (path[0] !== root || path.length < 2) {
      // `mcp_servers = { name = { ... } }` at the top level.
      if (path.length === 1 && path[0] === root && item.value.kind === "table") {
        for (const [name, value] of item.value.entries) {
          if (value.kind !== "table") continue;
          for (const [key, inner] of value.entries) setPath(serverTable(name), [key], inner);
        }
      }
      continue;
    }
    const name = path[1]!;
    if (path.length === 2) {
      if (item.value.kind === "table") {
        for (const [key, inner] of item.value.entries) setPath(serverTable(name), [key], inner);
      }
      continue;
    }
    setPath(serverTable(name), path.slice(2), item.value);
  }
  return servers;
}

function toPlain(value: TomlValue): TomlPlain {
  switch (value.kind) {
    case "string":
    case "boolean":
      return value.value;
    case "raw":
      return value.raw;
    case "array":
      return value.items.map(toPlain);
    case "table":
      return Object.fromEntries([...value.entries].map(([key, inner]) => [key, toPlain(inner)]));
  }
}

function fromPlain(value: TomlPlain): TomlValue {
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (Array.isArray(value)) return { kind: "array", items: value.map(fromPlain) };
  return {
    kind: "table",
    entries: new Map(
      Object.entries(value as Record<string, TomlPlain>).map(([key, inner]) => [
        key,
        fromPlain(inner),
      ]),
    ),
  };
}

/** Every server table under `root`, by name. Throws {@link TomlSyntaxError}. */
export function readTomlServers(
  text: string,
  root: string,
): Record<string, Record<string, TomlPlain>> {
  const servers: Record<string, Record<string, TomlPlain>> = {};
  for (const [name, value] of serverValues(scan(text), root)) {
    const plain = toPlain(value);
    if (typeof plain === "object" && !Array.isArray(plain)) {
      servers[name] = plain as Record<string, TomlPlain>;
    }
  }
  return servers;
}

const encodeKey = (key: string): string => (/^[A-Za-z0-9_-]+$/.test(key) ? key : encodeString(key));

function encodeString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"') out += '\\"';
    else if (char === "\\") out += "\\\\";
    else if (char === "\n") out += "\\n";
    else if (char === "\t") out += "\\t";
    else if (char === "\r") out += "\\r";
    else if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`;
    } else out += char;
  }
  return `${out}"`;
}

function encodeValue(value: TomlValue): string {
  switch (value.kind) {
    case "string":
      return encodeString(value.value);
    case "boolean":
      return value.value ? "true" : "false";
    case "raw":
      return value.raw;
    case "array":
      return `[${value.items.map(encodeValue).join(", ")}]`;
    case "table":
      return value.entries.size === 0
        ? "{}"
        : `{ ${[...value.entries].map(([key, inner]) => `${encodeKey(key)} = ${encodeValue(inner)}`).join(", ")} }`;
  }
}

/** A server as table text: its own keys, then each table of plain values as a sub-table. */
function encodeServer(root: string, name: string, server: TomlValue): string {
  if (server.kind !== "table") return "";
  const header = (path: ReadonlyArray<string>) => `[${path.map(encodeKey).join(".")}]\n`;
  const isSubTable = (value: TomlValue) =>
    value.kind === "table" && [...value.entries.values()].every((inner) => inner.kind !== "table");
  let out = header([root, name]);
  for (const [key, value] of server.entries) {
    if (!isSubTable(value)) out += `${encodeKey(key)} = ${encodeValue(value)}\n`;
  }
  for (const [key, value] of server.entries) {
    if (!isSubTable(value) || value.kind !== "table") continue;
    out += `\n${header([root, name, key])}`;
    for (const [innerKey, inner] of value.entries) {
      out += `${encodeKey(innerKey)} = ${encodeValue(inner)}\n`;
    }
  }
  return out;
}

function appendBlock(text: string, block: string): string {
  if (text.length === 0) return block;
  const separator = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${separator}${block}`;
}

/** `text` with the server `name` added as a table at its end. */
export function appendTomlServer(
  text: string,
  root: string,
  name: string,
  server: Readonly<Record<string, TomlPlain>>,
): string {
  return appendBlock(text, encodeServer(root, name, fromPlain(server)));
}

interface Span {
  readonly start: number;
  readonly end: number;
}

/** Where the server `name` is written: its tables (to their last key) and its stray keys. */
function serverSpans(items: ReadonlyArray<Item>, root: string, name: string): Span[] {
  const prefix = [root, name];
  const spans: Span[] = [];
  let block: { start: number; end: number } | undefined;
  for (const item of items) {
    if (item.kind === "header") {
      if (block !== undefined) spans.push(block);
      block =
        !item.array && startsWithPath(item.path, prefix)
          ? { start: item.start, end: item.end }
          : undefined;
      continue;
    }
    if (block !== undefined) {
      block.end = item.end;
      continue;
    }
    if (!item.inArrayTable && startsWithPath(fullPath(item), prefix)) {
      spans.push({ start: item.start, end: item.end });
    }
  }
  if (block !== undefined) spans.push(block);
  return spans;
}

function cut(text: string, spans: ReadonlyArray<Span>): string {
  let out = text;
  for (const span of [...spans].toSorted((a, b) => b.start - a.start)) {
    let end = span.end;
    let before = out.slice(0, span.start);
    // A removed table leaves one blank line between its neighbours, not two,
    // and none at the end of the file.
    if ((before.endsWith("\n\n") || before.length === 0) && out[end] === "\n") end += 1;
    if (end >= out.length && before.endsWith("\n\n")) before = before.slice(0, -1);
    out = before + out.slice(end);
  }
  return out;
}

/** `text` without the server `name`; unchanged when it is not there. */
export function removeTomlServer(text: string, root: string, name: string): string {
  return cut(text, serverSpans(scan(text), root, name));
}

/**
 * `text` with `key = value` set on the server `name` — in place when the
 * server is a table of its own; an inline or dotted server is rewritten as
 * one at the end. Unchanged when the server is not there.
 */
export function setTomlServerBoolean(
  text: string,
  root: string,
  name: string,
  key: string,
  value: boolean,
): string {
  const items = scan(text);
  const servers = serverValues(items, root);
  const server = servers.get(name);
  if (server?.kind !== "table") return text;
  const encoded = value ? "true" : "false";
  const headerIndex = items.findIndex(
    (item) =>
      item.kind === "header" &&
      !item.array &&
      item.path.length === 2 &&
      startsWithPath(item.path, [root, name]),
  );
  if (headerIndex !== -1) {
    const header = items[headerIndex] as HeaderItem;
    for (const item of items.slice(headerIndex + 1)) {
      if (item.kind === "header") break;
      if (item.key.length === 1 && item.key[0] === key) {
        return text.slice(0, item.valueStart) + encoded + text.slice(item.valueEnd);
      }
    }
    // A key of its own table defined elsewhere (dotted) would be a duplicate: rewrite instead.
    const elsewhere = server.entries.has(key);
    if (!elsewhere) {
      const newline = text.slice(header.start, header.end).endsWith("\n") ? "" : "\n";
      return `${text.slice(0, header.end)}${newline}${encodeKey(key)} = ${encoded}\n${text.slice(header.end)}`;
    }
  }
  server.entries.set(key, { kind: "boolean", value });
  return appendBlock(cut(text, serverSpans(items, root, name)), encodeServer(root, name, server));
}
