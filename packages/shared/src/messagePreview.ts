/**
 * The opening words of a chat message, the way a list row quotes them: one
 * line, markdown's marks dropped, cut at a word well within
 * `MESSAGE_PREVIEW_MAX_LENGTH` characters. The server stores this on the
 * thread shell (`OrchestrationThreadShell.latestMessagePreview`) so a row
 * that lists conversations can say what was last said without loading a
 * single message.
 */
export const MESSAGE_PREVIEW_MAX_LENGTH = 160;

const FENCE_LINE = /^\s{0,3}(?:`{3,}|~{3,}).*$/gmu;
const HORIZONTAL_RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gmu;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/gu;
const LINK = /\[([^\]]+)\]\([^)]*\)/gu;
const STRONG = /(\*\*|__)(?=\S)([^\n]*?\S)\1/gu;
const EMPHASIS = /(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/gu;
const STRIKE = /~~(?=\S)([^\n]*?\S)~~/gu;
const CODE = /`([^`\n]+)`/gu;
const BLOCK_MARKS = /^\s{0,3}(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,3}[.)]\s+)/gmu;
const TRAILING_PUNCTUATION = /[\s,;:.!?…-]+$/u;
const QUOTE_LINE = /^[ \t]{0,3}(?:>[ \t]?)+(.*)$/gmu;
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/iu;

/**
 * GitHub's five alert kinds and the word each is said as: the chat's callout
 * label, and the word a callout keeps wherever a message is read as plain
 * words.
 */
export const GITHUB_ALERT_WORDS: ReadonlyMap<string, string> = new Map([
  ["note", "Note"],
  ["tip", "Tip"],
  ["important", "Important"],
  ["warning", "Warning"],
  ["caution", "Caution"],
]);

/**
 * A markdown text's quotes as their words: every quote marker dropped, and a
 * GitHub alert's marker line (`> [!WARNING]`) said as its word — "Warning:" —
 * so it runs into the alert's first line once the lines are joined, as the
 * chat draws it. Only a marker alone on its quote's line counts, GitHub's rule.
 */
export function quoteWords(markdown: string): string {
  return markdown.replace(QUOTE_LINE, (_line, rest: string) => {
    const kind = ALERT_MARKER.exec(rest)?.[1];
    return kind === undefined ? rest : `${GITHUB_ALERT_WORDS.get(kind.toLowerCase())}:`;
  });
}

/**
 * A markdown message as plain words on one line, every one of them: what a
 * preview cuts, and what a search quotes around the words it found.
 */
export function messageWords(markdown: string): string {
  return quoteWords(markdown)
    .replace(FENCE_LINE, "")
    .replace(HORIZONTAL_RULE, "")
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(STRONG, "$2")
    .replace(EMPHASIS, "$1$2")
    .replace(STRIKE, "$1")
    .replace(CODE, "$1")
    .replace(BLOCK_MARKS, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** A markdown message as plain words, or null when nothing is left to quote. */
export function messagePreviewText(markdown: string): string | null {
  const words = maskSecrets(messageWords(markdown));
  if (words.length === 0) return null;
  return truncateAtWord(words, MESSAGE_PREVIEW_MAX_LENGTH);
}

/** What a quote shows where a credential was. */
export const SECRET_MASK = "••••••";

/** Credentials that say what they are by their shape alone. */
const SHAPED_SECRETS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gu,
  /\beyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]{5,}/gu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abposr]-[\w-]{10,})/gu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/gu,
  /\bsk-(?:ant-)?[\w-]{20,}/gu,
  /\bAIza[\w-]{35}\b/gu,
];
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/-]+=*/gu;
const URL_PASSWORD = /(\b[a-z][a-z\d+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/giu;

/** The words that name a credential, in the languages its owners write in. */
const SECRET_WORDS = new Set([
  "password",
  "passwd",
  "passphrase",
  "pwd",
  "secret",
  "secrets",
  "token",
  "tokens",
  "credential",
  "credentials",
  "apikey",
  "heslo",
  "passwort",
  "kennwort",
  "contraseña",
  "contrasena",
  "senha",
]);
const SECRET_PAIRS = new Set([
  "api key",
  "access key",
  "private key",
  "secret key",
  "license key",
  "signing key",
  "encryption key",
  "client secret",
]);
/** What joins a credential's name to its value in a sentence: "the password is …". */
const CONNECTORS = new Set(["is", "was", "je", "zní"]);
const SEPARATOR = /^(:=|=>|=|:)$/u;
const NAMED = /^([^=:]+?)(:=|=>|=|:)(.*)$/u;
/** A value that points at a credential rather than being one: `process.env.KEY`, `$TOKEN`. */
const REFERENCE = /^(?:\$|process\.env|os\.environ|env\.|getenv|<|\{|\[|\()/u;
const TRAILING = /[,;.)!?…]+$/u;

function nameParts(name: string): ReadonlyArray<string> {
  return name
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .split(/[\s_.-]+/u)
    .map((part) => part.toLocaleLowerCase())
    .filter((part) => part.length > 0);
}

/** Whether a word names a credential: `password`, `SHOP_API_PASSWORD`, `apiKey`, `DB_PASS`. */
function namesSecret(name: string): boolean {
  const parts = nameParts(name.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ""));
  if (parts.some((part) => SECRET_WORDS.has(part))) return true;
  // "pass" is a password only inside a name — `DB_PASS`, never "pass the tests".
  if (parts.length > 1 && parts.includes("pass")) return true;
  return parts.some((part, index) => SECRET_PAIRS.has(`${part} ${parts[index + 1] ?? ""}`));
}

/** `SHOP_API_PASSWORD`, `apiKey`: a name a value follows with no mark between them. */
const nameLike = (name: string) =>
  name.includes("_") || /[a-z][A-Z]/u.test(name) || /^[A-Z\d]{3,}$/u.test(name);

/** A word that reads as a credential rather than as prose: "hunter2", not "expired". */
const secretLike = (value: string) =>
  value.length >= 6 &&
  (/\d/u.test(value) || /[^\p{L}\d]/u.test(value) || /\p{Ll}\p{Lu}/u.test(value));

/**
 * A text with every credential in it masked: the ones known by their shape
 * (tokens, keys, a bearer's, a password in a URL), and every value that
 * follows a credential's name — after `=` or `:`, after a name like
 * `SHOP_API_PASSWORD`, or in a sentence ("the password is hunter2"). The name
 * stays, so the words still say what was there.
 */
export function maskSecrets(text: string): string {
  const known = maskedTexts.get(text);
  if (known !== undefined) {
    // Most recently used last: the oldest is what a full cache lets go.
    maskedTexts.delete(text);
    maskedTexts.set(text, known);
    return known;
  }
  const masked = maskSecretsOnce(text);
  if (maskedTexts.size >= MASKED_TEXTS_HELD) {
    maskedTexts.delete(maskedTexts.keys().next().value!);
  }
  maskedTexts.set(text, masked);
  return masked;
}

/**
 * The texts lately masked: the menu, the projects page and a conversation's
 * panel each mask every Mate's previews on every render, and those previews
 * change only when a message completes.
 */
const MASKED_TEXTS_HELD = 512;
const maskedTexts = new Map<string, string>();

function maskSecretsOnce(text: string): string {
  let masked = text;
  for (const shape of SHAPED_SECRETS) masked = masked.replace(shape, SECRET_MASK);
  masked = masked.replace(BEARER, `$1 ${SECRET_MASK}`).replace(URL_PASSWORD, `$1${SECRET_MASK}$3`);
  return maskNamedSecrets(masked);
}

function maskNamedSecrets(text: string): string {
  const words = Array.from(text.matchAll(/\S+/gu), (match) => ({
    text: match[0],
    start: match.index,
  }));
  const cuts: Array<{ readonly start: number; readonly end: number }> = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const named = NAMED.exec(word.text);
    const name = named?.[1] ?? word.text;
    if (!namesSecret(name)) continue;
    // Where the value starts, and whether a mark says it is one.
    let at: number;
    let marked: boolean;
    if (named !== null && (named[3] ?? "").length > 0) {
      at = word.start + named[1]!.length + named[2]!.length;
      marked = true;
    } else if (named !== null) {
      const next = words[index + 1];
      if (next === undefined) continue;
      at = next.start;
      marked = true;
    } else {
      const next = words[index + 1];
      if (next === undefined) continue;
      if (SEPARATOR.test(next.text)) {
        const value = words[index + 2];
        if (value === undefined) continue;
        at = value.start;
        marked = true;
      } else if (nameLike(name)) {
        at = next.start;
        marked = false;
      } else if (CONNECTORS.has(next.text.toLocaleLowerCase())) {
        const value = words[index + 2];
        if (value === undefined) continue;
        at = value.start;
        marked = false;
      } else continue;
    }
    // A quoted value runs to its closing quote, spaces and all; any other
    // to the next space, the sentence's own punctuation left standing.
    const rest = text.slice(at);
    const quote = rest[0];
    const close = quote === "'" || quote === '"' || quote === "`" ? rest.indexOf(quote, 1) : -1;
    let end: number;
    if (close !== -1) end = at + close + 1;
    else {
      const space = rest.search(/\s/u);
      end = space === -1 ? text.length : at + space;
      end -= TRAILING.exec(text.slice(at, end))?.[0].length ?? 0;
    }
    const value = text.slice(at, end);
    if (value.length === 0 || value.includes(SECRET_MASK) || REFERENCE.test(value)) continue;
    if (!marked && !secretLike(value)) continue;
    cuts.push({ start: at, end });
    while (index + 1 < words.length && words[index + 1]!.start < end) index += 1;
  }
  let out = "";
  let cursor = 0;
  for (const cut of cuts) {
    out += `${text.slice(cursor, cut.start)}${SECRET_MASK}`;
    cursor = cut.end;
  }
  return out + text.slice(cursor);
}

function truncateAtWord(text: string, maxLength: number): string {
  const characters = Array.from(text);
  if (characters.length <= maxLength) return text;
  const cut = characters.slice(0, maxLength).join("");
  const lastSpace = cut.lastIndexOf(" ");
  const atWord = lastSpace >= maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${atWord.replace(TRAILING_PUNCTUATION, "")}…`;
}
