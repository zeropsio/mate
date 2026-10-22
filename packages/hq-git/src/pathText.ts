/**
 * A path as git holds it, bytes, carried as a string: its valid UTF-8 as text and every other
 * byte `b` as the lone surrogate `U+DC00 + b` (Python's `surrogateescape`). It shows as "�" where
 * the bytes are not text and still names those bytes exactly when it goes back to git.
 *
 * @module pathText
 */

const fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const decoded = (bytes: Uint8Array) => {
  try {
    return fatal.decode(bytes);
  } catch {
    return null;
  }
};

/** The bytes' path: valid UTF-8 as text, each other byte as its lone surrogate. */
export const pathText = (bytes: Uint8Array): string => {
  const whole = decoded(bytes);
  if (whole !== null) return whole;
  let out = "";
  for (let at = 0; at < bytes.length;) {
    const ascii = bytes.subarray(at).findIndex((byte) => byte >= 0x80);
    if (ascii !== 0) {
      const end = ascii === -1 ? bytes.length : at + ascii;
      out += decoded(bytes.subarray(at, end));
      at = end;
      continue;
    }
    // The shortest prefix that is text is one character; none is a byte that is not.
    const length = [1, 2, 3, 4].find((n) => decoded(bytes.subarray(at, at + n)) !== null);
    out +=
      length === undefined
        ? String.fromCharCode(0xdc00 + bytes[at]!)
        : decoded(bytes.subarray(at, at + length));
    at += length ?? 1;
  }
  return out;
};

const ESCAPED = /[\uDC80-\uDCFF]/u;

/** Whether the path holds a byte that is not UTF-8 text. */
export const holdsRawBytes = (path: string): boolean => ESCAPED.test(path);

/** The bytes a path names: the inverse of {@link pathText}. */
export const pathBytes = (path: string): Buffer =>
  Buffer.concat(
    path
      .split(/([\uDC80-\uDCFF])/u)
      .map((part, index) =>
        index % 2 === 1 ? Buffer.from([part.charCodeAt(0) - 0xdc00]) : Buffer.from(part, "utf8"),
      ),
  );
