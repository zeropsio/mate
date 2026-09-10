/**
 * Blob preview decisions for the Data panel — pure, UI-free (design-system R1).
 *
 * A console `blob` response carries base64 bytes plus a content type the
 * server sniffed, and both lie often enough that the content type alone
 * cannot pick a rendering: a Valkey string holding `\x00\xff\xfe` arrives as
 * `text/plain`. So every payload is decoded once and classified on what the
 * bytes actually are — printable UTF-8 renders as text or pretty JSON,
 * anything else as a hex dump.
 */
import type { ZeropsDataConsoleBlob } from "@t3tools/contracts";

/** How much of a payload the card is willing to render. */
const MAX_HEX_BYTES = 4096;
const MAX_TEXT_BYTES = 256 * 1024;

const HEX_BYTES_PER_LINE = 16;

const IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/avif",
]);

/** Fields every classification carries, so the card renders one meta line from one place. */
interface BlobPreviewMeta {
  readonly contentType: string;
  readonly size: number;
  readonly truncated: boolean;
  /** `contentType · N bytes` plus `· expires in …` when the value has a TTL. */
  readonly meta: string;
}

export type BlobPreview = BlobPreviewMeta &
  (
    | { readonly kind: "empty" }
    | { readonly kind: "image"; readonly dataUri: string }
    | { readonly kind: "text"; readonly text: string; readonly moreBytes?: number }
    | { readonly kind: "json"; readonly text: string }
    | { readonly kind: "vector-json"; readonly text: string }
    | { readonly kind: "stream-summary"; readonly text: string }
    | { readonly kind: "hex"; readonly dump: string; readonly moreBytes?: number }
  );

export type BlobPreviewKind = BlobPreview["kind"];

/** `undefined` on malformed base64 rather than throwing — a pure model function never throws on server input. */
function decodeBase64(base64: string): Uint8Array | undefined {
  const clean = base64.replace(/[\r\n]/g, "");
  if (clean === "") return new Uint8Array(0);
  try {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

/** `undefined` when the bytes are not valid UTF-8 (never U+FFFD substitution — the caller hex-dumps instead). */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Valid UTF-8 whose only control characters are tab, newline and carriage return. */
export function isPrintableUtf8(bytes: Uint8Array): boolean {
  const text = decodeUtf8(bytes);
  if (text === undefined) return false;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** A TTL in the coarsest unit that still reads as a duration: `45 s`, `2 min`, `23 h`, `2 d`. */
export function humanizeTtl(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

/** `offset  hex bytes  |ascii gutter|`, 16 bytes per line, stopping after `limit` bytes. */
export function hexDump(bytes: Uint8Array, limit: number): string {
  const shown = bytes.subarray(0, limit);
  const lines: string[] = [];
  for (let offset = 0; offset < shown.length; offset += HEX_BYTES_PER_LINE) {
    const line = shown.subarray(offset, offset + HEX_BYTES_PER_LINE);
    const hex = Array.from(line, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(line, (byte) =>
      byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".",
    ).join("");
    lines.push(
      `${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(HEX_BYTES_PER_LINE * 3 - 1, " ")}  |${ascii}|`,
    );
  }
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collapseVectorValue(value: unknown): unknown {
  if (Array.isArray(value)) return `[${value.length} numbers]`;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, collapseVectorValue(entry)]),
    );
  }
  return value;
}

/**
 * Replaces a document's top-level `vector`/`vectors` value with `[<n> numbers]`
 * — a named-vectors object collapses per name. Nothing else of the payload is
 * touched: an embedding is unreadable, the rest of the point is the answer.
 */
export function collapseVectors(json: unknown): unknown {
  if (!isRecord(json)) return json;
  return Object.fromEntries(
    Object.entries(json).map(([key, value]) =>
      key === "vector" || key === "vectors" ? [key, collapseVectorValue(value)] : [key, value],
    ),
  );
}

function prettyJson(text: string, transform: (value: unknown) => unknown): string | undefined {
  try {
    return JSON.stringify(transform(JSON.parse(text)), null, 2);
  } catch {
    return undefined;
  }
}

function metaLine(blob: ZeropsDataConsoleBlob): string {
  const base = `${blob.contentType} · ${blob.size.toLocaleString()} bytes`;
  return blob.ttlSeconds === undefined
    ? base
    : `${base} · expires in ${humanizeTtl(blob.ttlSeconds)}`;
}

/**
 * Precedence: an empty or undecodable body first (there is nothing to show),
 * then an untruncated image (bytes the browser renders itself), then the
 * `vector`/`streamMetadata` flags that say what the text *means*, then the
 * bytes themselves — printable UTF-8 as JSON or text, anything else as hex.
 */
export function classifyBlob(blob: ZeropsDataConsoleBlob): BlobPreview {
  const common = {
    contentType: blob.contentType,
    size: blob.size,
    truncated: blob.truncated,
    meta: metaLine(blob),
  } as const;

  const bytes = decodeBase64(blob.data);
  if (bytes === undefined || bytes.length === 0) return { ...common, kind: "empty" };

  if (IMAGE_CONTENT_TYPES.has(blob.contentType) && !blob.truncated) {
    return { ...common, kind: "image", dataUri: `data:${blob.contentType};base64,${blob.data}` };
  }

  if (!isPrintableUtf8(bytes)) {
    return {
      ...common,
      kind: "hex",
      dump: hexDump(bytes, MAX_HEX_BYTES),
      ...(bytes.length > MAX_HEX_BYTES ? { moreBytes: bytes.length - MAX_HEX_BYTES } : {}),
    };
  }

  const text = decodeUtf8(bytes) ?? "";

  if (blob.streamMetadata) return { ...common, kind: "stream-summary", text };

  if (blob.vector) {
    const collapsed = prettyJson(text, collapseVectors);
    if (collapsed !== undefined) return { ...common, kind: "vector-json", text: collapsed };
  } else if (blob.contentType === "application/json") {
    const pretty = prettyJson(text, (value) => value);
    if (pretty !== undefined) return { ...common, kind: "json", text: pretty };
  }

  if (bytes.length > MAX_TEXT_BYTES) {
    return {
      ...common,
      kind: "text",
      text: text.slice(0, MAX_TEXT_BYTES),
      moreBytes: bytes.length - MAX_TEXT_BYTES,
    };
  }
  return { ...common, kind: "text", text };
}
