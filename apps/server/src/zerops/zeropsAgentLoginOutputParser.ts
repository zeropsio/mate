/**
 * Pure terminal-output parser for the server-driven agent login session
 * (S7 follow-up F8) — ported near-verbatim from the Zerops GUI's own walker,
 * `zcp-agent-auth-dialog.output-parser.ts` (frontend-legacy, ours), which
 * solved the exact same problem this module has: a PTY's raw byte stream is
 * chunked at arbitrary boundaries (here, `TerminalManager`'s own read/flush
 * size), so a regex run against a raw, accumulating buffer can match a
 * PREFIX of a token that is still being written — acting on it emits a
 * truncated URL or a truncated device code. The fix is the same two-layer
 * approach the GUI walker uses:
 *
 * 1. {@link parseTerminalOutput} turns raw bytes into `clean` text plus a
 *    list of fully-terminated OSC 8 hyperlink targets, tracking two kinds
 *    of boundary as it scans:
 *      - a COMMIT ('\n'): the emitter finished a line. Text around it is
 *        trustworthy and adjacent, whether the line ending arrives as a
 *        bare '\n' or PTY-style CRLF ('\r' immediately followed by '\n') —
 *        line discipline (ONLCR) rewrites every '\n' to '\r\n' on the wire.
 *        A soft-wrapped OAuth URL (F8's own live finding: a ~330-char URL a
 *        narrow terminal renders wrapped across visual rows) is NOT this
 *        case — that wrapping is the CLIENT terminal's own rendering of an
 *        unbroken byte stream; the raw PTY bytes this module reads carry no
 *        inserted newline at the wrap point, so it needs no special
 *        handling here.
 *      - an INVALIDATION ('\v'): the emitter relocated the cursor or erased
 *        something (a lone carriage return not followed by '\n', cursor
 *        movement, line erase, screen redraw). Text before this boundary
 *        may be an intermediate render about to be overwritten.
 *    A trailing bare '\r' at the very end of the buffer is genuinely
 *    ambiguous (the next chunk could turn it into a CRLF commit or a bare-CR
 *    rewrite), so it is held back from `clean` and reported via
 *    `endsInsideEscape` — the same "wait for more bytes" signal an
 *    unterminated escape/OSC sequence produces. This is also where ANSI/OSC
 *    stripping happens: `clean` never carries an escape sequence.
 *
 * 2. {@link matchCompletedToken} / {@link matchAuthUrl} use those boundaries
 *    to decide whether a regex match is safe to act on: a match butting up
 *    against an invalidation boundary, or against one more valid token
 *    character, is exactly the "prefix of something longer" shape that
 *    causes truncation — it is skipped in favor of a later, terminated
 *    occurrence rather than trusted outright.
 */

/**
 * Character-class source for URL tokens — RFC3986 unreserved + reserved
 * characters, plus '%' for percent-encoding. Defines the token tail
 * {@link matchAuthUrl} appends to a handler's anchor and the continuation
 * gate it checks completion against, so extraction and gating share one
 * charset by construction.
 */
const URL_TOKEN_CHAR_SRC = "a-zA-Z0-9\\-._~:/?#[\\]@!$&'()*+,;=%";

/** Single-char test: does this character continue a URL token? */
export const URL_TOKEN_CONTINUATION = new RegExp(`[${URL_TOKEN_CHAR_SRC}]`);

/** Single-char test: does this character continue a device code token? */
export const DEVICE_CODE_CONTINUATION = /[A-Z0-9-]/;

export interface ParsedTerminalOutput {
  /**
   * Adjacency-preserving cleaned text. '\n' = the emitter committed a line.
   * '\v' = invalidation boundary (the emitter relocated the cursor / erased
   * — text before it may be a retracted intermediate render).
   */
  readonly clean: string;
  /** URIs of COMPLETE OSC 8 hyperlink opens (terminator arrived), in stream order. */
  readonly hyperlinkUris: ReadonlyArray<string>;
  /**
   * True when the raw buffer ends inside an unterminated escape/OSC
   * sequence — emission is provably in progress; the caller must not act
   * or wipe the buffer.
   */
  readonly endsInsideEscape: boolean;
}

/** CSI parameter + intermediate bytes span 0x20-0x3F (ECMA-48). */
function isCsiParamOrIntermediate(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x20 && code <= 0x3f;
}

/** Cursor/erase-relocating single-char ESC sequences (DECSC/DECRC/reverse index). */
const RELOCATING_SINGLE_CHAR_ESC = new Set(["7", "8", "M"]);

export function parseTerminalOutput(raw: string): ParsedTerminalOutput {
  const n = raw.length;
  let clean = "";
  const hyperlinkUris: Array<string> = [];
  let endsInsideEscape = false;
  let inLink = false;
  let inGraphics = false;
  let graphicsSpaceEmitted = false;
  let i = 0;

  while (i < n) {
    const ch = raw[i];

    if (ch === "\x1b") {
      i++;
      if (i >= n) {
        endsInsideEscape = true;
        break;
      }
      const next = raw[i];

      if (next === "[") {
        i++;
        while (i < n && isCsiParamOrIntermediate(raw[i]!)) i++;
        if (i >= n) {
          endsInsideEscape = true;
          break;
        }
        const final = raw[i];
        i++;
        // SGR / mode set-reset ('m'/'h'/'l') move no cursor — adjacency preserved.
        if (final !== "m" && final !== "h" && final !== "l") {
          clean += "\v";
          inLink = false;
        }
        continue;
      }

      if (next === "]") {
        i++;
        const payloadStart = i;
        let contentEnd = -1;
        let terminatorEnd = -1;
        let j = i;
        while (j < n) {
          const c = raw[j];
          if (c === "\x07") {
            contentEnd = j;
            terminatorEnd = j + 1;
            break;
          }
          if (c === "\x1b") {
            if (j + 1 < n && raw[j + 1] === "\\") {
              contentEnd = j;
              terminatorEnd = j + 2;
              break;
            }
            if (j + 1 >= n) break; // cut right at a possible ST — incomplete
          }
          j++;
        }
        if (terminatorEnd === -1) {
          endsInsideEscape = true;
          break;
        }
        const content = raw.slice(payloadStart, contentEnd);
        if (content.startsWith("8;")) {
          const rest = content.slice(2);
          const sep = rest.indexOf(";");
          const uri = sep === -1 ? "" : rest.slice(sep + 1);
          if (uri !== "") {
            hyperlinkUris.push(uri);
            clean += `${uri}\n`;
            inLink = true;
          } else {
            // Empty-uri OSC 8: link-close when in a link, silent delete otherwise.
            inLink = false;
          }
        }
        // Any other OSC command: delete.
        i = terminatorEnd;
        continue;
      }

      if (next === "(") {
        i++;
        if (i >= n) {
          endsInsideEscape = true;
          break;
        }
        const sel = raw[i];
        i++;
        if (sel === "0") {
          inGraphics = true;
          graphicsSpaceEmitted = false;
        } else if (sel === "B") {
          inGraphics = false;
        }
        continue;
      }

      // Single-char ESC sequence.
      i++;
      if (RELOCATING_SINGLE_CHAR_ESC.has(next!)) {
        clean += "\v";
        inLink = false;
      }
      continue;
    }

    if (ch === "\n") {
      clean += "\n";
      inLink = false;
      i++;
      continue;
    }

    if (ch === "\r") {
      if (i + 1 >= n) {
        // Could still resolve into a CRLF commit with the next chunk — hold it back.
        endsInsideEscape = true;
        break;
      }
      if (raw[i + 1] === "\n") {
        clean += "\n";
        inLink = false;
        i += 2;
        continue;
      }
      clean += "\v";
      inLink = false;
      i++;
      continue;
    }

    if (ch === "\x08") {
      clean += "\v";
      inLink = false;
      i++;
      continue;
    }

    const code = ch!.charCodeAt(0);
    if (code < 0x20) {
      // Bare BEL and other control chars: delete.
      i++;
      continue;
    }

    // Printable character.
    if (inLink) {
      // In-link presentation slice — never token text.
    } else if (inGraphics) {
      // Line-drawing glyphs are printed output, not retraction — they commit
      // whatever precedes them. A whole run collapses to one boundary space.
      if (!graphicsSpaceEmitted) {
        clean += " ";
        graphicsSpaceEmitted = true;
      }
    } else {
      clean += ch;
    }
    i++;
  }

  return {
    clean: clean.replace(/\v+/g, "\v"),
    hyperlinkUris,
    endsInsideEscape,
  };
}

export type TokenMatchResult =
  | { readonly status: "complete"; readonly value: string }
  | { readonly status: "pending" }
  | { readonly status: "none" };

const GLOBALIZED = new WeakMap<RegExp, RegExp>();
function globalized(pattern: RegExp): RegExp {
  let g = GLOBALIZED.get(pattern);
  if (!g) {
    g = pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
    GLOBALIZED.set(pattern, g);
  }
  return g;
}

const URL_TAILED = new WeakMap<RegExp, RegExp>();
function withUrlTokenTail(anchor: RegExp): RegExp {
  let tailed = URL_TAILED.get(anchor);
  if (!tailed) {
    tailed = new RegExp(`${anchor.source}[${URL_TOKEN_CHAR_SRC}]*`, anchor.flags);
    URL_TAILED.set(anchor, tailed);
  }
  return tailed;
}

export function matchCompletedToken(
  clean: string,
  pattern: RegExp,
  continuation: RegExp,
): TokenMatchResult {
  const global = globalized(pattern);
  global.lastIndex = 0;

  let sawPending = false;
  let match: RegExpExecArray | null;

  while ((match = global.exec(clean))) {
    const matchEnd = match.index + match[0].length;

    if (match[0].length === 0) {
      global.lastIndex++;
      continue;
    }

    if (matchEnd === clean.length) {
      sawPending = true;
      continue;
    }

    const nextChar = clean[matchEnd];
    if (nextChar === "\v" || continuation.test(nextChar!)) {
      continue;
    }

    return { status: "complete", value: match[1] ?? match[0] };
  }

  return sawPending ? { status: "pending" } : { status: "none" };
}

/**
 * `anchor` is a URL-prefix pattern (interior wildcards allowed, NO trailing
 * wildcard) — the matcher appends the URL token tail itself, so the greedy
 * extraction and the completion gate can never diverge.
 */
export function matchAuthUrl(parsed: ParsedTerminalOutput, anchor: RegExp): TokenMatchResult {
  const framedUri = parsed.hyperlinkUris.find((uri) => anchor.test(uri));
  if (framedUri !== undefined) {
    return { status: "complete", value: framedUri };
  }
  return matchCompletedToken(parsed.clean, withUrlTokenTail(anchor), URL_TOKEN_CONTINUATION);
}
