/**
 * A scope's values as `.env` text, and back: two sections, plain and sensitive; a sensitive value
 * is written masked, meaning "keep what is stored". The text the person edits becomes the writes
 * that make the scope say it — an added line adds, a changed one updates, a deleted one removes —
 * each line marked by what it does, and every line that cannot be applied named with why.
 */
import type { VaultScope, VaultValue, VaultWrite } from "@t3tools/client-runtime/data";

import { KEY_FORMAT_WORDS, keyProblem, sensitiveWordIn, VAULT_KEY_PATTERN } from "./vault.logic";

/** Stands for a sensitive value as stored: kept unless typed over. */
export const VAULT_MASK = "••••••••";

export type VaultTextSection = "plain" | "sensitive";

export interface VaultText {
  readonly plain: string;
  readonly sensitive: string;
}

export interface VaultTextProblem {
  readonly section: VaultTextSection;
  /** The line's index in its section, from 0. */
  readonly line: number;
  readonly key: string | null;
  readonly message: string;
}

export type VaultTextMark = "+" | "~" | "!" | null;

export interface VaultTextDiff {
  /** Adds, then updates, then removals. */
  readonly writes: ReadonlyArray<VaultWrite>;
  readonly problems: ReadonlyArray<VaultTextProblem>;
  /** One mark per line of each section. */
  readonly marks: Readonly<Record<VaultTextSection, ReadonlyArray<VaultTextMark>>>;
}

const needsQuotes = (value: string) =>
  /[\n\r]/u.test(value) || value !== value.trim() || /^["']/u.test(value);

const quote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`;

const line = (key: string, value: string) => `${key}=${needsQuotes(value) ? quote(value) : value}`;

/** The scope's values as text, each section by key. */
export function vaultToText(scope: VaultScope): VaultText {
  const ordered = scope.values.toSorted((a, b) => a.key.localeCompare(b.key));
  return {
    plain: ordered
      .filter((value) => !value.sensitive)
      .map((value) => line(value.key, value.value ?? ""))
      .join("\n"),
    sensitive: ordered
      .filter((value) => value.sensitive)
      .map((value) => line(value.key, VAULT_MASK))
      .join("\n"),
  };
}

type ParsedLine =
  | { readonly kind: "empty" }
  | { readonly kind: "bad"; readonly key: string | null; readonly message: string }
  | { readonly kind: "pair"; readonly key: string; readonly value: string };

const unquote = (raw: string): string => {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw
      .slice(1, -1)
      .replace(/\\(.)/gu, (_, char: string) => (char === "n" ? "\n" : char === "r" ? "\r" : char));
  }
  return raw;
};

function parseLine(text: string): ParsedLine {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return { kind: "empty" };
  const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/u.exec(trimmed);
  if (match === null) return { kind: "bad", key: null, message: "Write it as KEY=value" };
  const key = match[1] ?? "";
  if (!VAULT_KEY_PATTERN.test(key)) return { kind: "bad", key, message: KEY_FORMAT_WORDS };
  return { kind: "pair", key, value: unquote(match[2] ?? "") };
}

/** The writes that make the scope say what the text says, or why a line cannot. */
export function diffVaultText(scope: VaultScope, text: VaultText): VaultTextDiff {
  const held = new Map<string, VaultValue>(scope.values.map((value) => [value.key, value]));
  const adds: VaultWrite[] = [];
  const updates: VaultWrite[] = [];
  const problems: VaultTextProblem[] = [];
  const marks: Record<VaultTextSection, VaultTextMark[]> = { plain: [], sensitive: [] };
  const seen = new Set<string>();
  /** Every key a line names in exactly its case: a held value it names is not removed. */
  const named = new Set<string>();

  for (const section of ["plain", "sensitive"] as const) {
    const sensitive = section === "sensitive";
    const lines = text[section] === "" ? [] : text[section].split("\n");
    lines.forEach((raw, index) => {
      const mark = (value: VaultTextMark) => {
        marks[section][index] = value;
      };
      const refuse = (key: string | null, message: string) => {
        problems.push({ section, line: index, key, message });
        mark("!");
      };
      mark(null);
      const parsed = parseLine(raw);
      if (parsed.kind === "empty") return;
      if (parsed.kind === "bad") return refuse(parsed.key, parsed.message);
      const { key, value } = parsed;
      named.add(key);
      if (seen.has(key.toUpperCase())) return refuse(key, `${key} is on two lines`);
      seen.add(key.toUpperCase());

      const current = held.get(key);
      if (current === undefined) {
        const problem = keyProblem(key, scope);
        if (problem !== null) return refuse(key, problem);
        if (value === VAULT_MASK) return refuse(key, `Type a value for ${key}`);
        adds.push({ kind: "add", key, value, sensitive });
        return mark("+");
      }
      const update = (next: string) => {
        updates.push({ kind: "update", id: current.id, key, value: next, sensitive });
        mark("~");
      };
      if (current.sensitive && !sensitive) {
        if (value === VAULT_MASK) return refuse(key, `Type ${key}'s value to make it plain`);
        return update(value);
      }
      if (!current.sensitive && sensitive) {
        return update(value === VAULT_MASK ? (current.value ?? "") : value);
      }
      if (current.sensitive) {
        if (value !== VAULT_MASK) update(value);
        return;
      }
      if (value !== current.value) update(value);
    });
  }

  const removes: VaultWrite[] = scope.values
    .filter((value) => !named.has(value.key))
    .map((value) => ({ kind: "remove", id: value.id, key: value.key }));

  return { writes: [...adds, ...updates, ...removes], problems, marks };
}

/** The `KEY=value` lines of a pasted `.env` (two lines or more), or null for anything else. */
export function envPasteLines(pasted: string): ReadonlyArray<string> | null {
  const lines = pasted
    .split(/\r?\n/u)
    .map((raw) => raw.trim())
    .filter((raw) => raw !== "" && !raw.startsWith("#"));
  if (lines.length < 2) return null;
  return lines.every((raw) => parseLine(raw).kind === "pair") ? lines : null;
}

/** A pasted `.env` added after the text, each line in its section by its name. */
export function pasteIntoText(text: VaultText, pasted: string): VaultText {
  const lines = envPasteLines(pasted) ?? [];
  const into = (section: string, adding: ReadonlyArray<string>) =>
    adding.length === 0 ? section : [section, ...adding].filter((part) => part !== "").join("\n");
  const sensitiveLine = (raw: string) => {
    const parsed = parseLine(raw);
    return parsed.kind === "pair" && sensitiveWordIn(parsed.key) !== null;
  };
  return {
    plain: into(
      text.plain,
      lines.filter((raw) => !sensitiveLine(raw)),
    ),
    sensitive: into(text.sensitive, lines.filter(sensitiveLine)),
  };
}
