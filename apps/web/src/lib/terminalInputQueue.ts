import { TERMINAL_WRITE_MAX_LENGTH } from "@t3tools/contracts";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

/** Sends one write; resolves false when it failed and the rest of the input should drop. */
type SendTerminalChunk = (chunk: string) => Promise<boolean>;

/** Splits input into writes that fit one `terminal.write`, never between a surrogate pair. */
export function chunkTerminalWrite(data: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + TERMINAL_WRITE_MAX_LENGTH, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Orders one terminal's input. Input longer than one write goes a chunk per round trip and later
 * input waits behind it; everything else goes out at once, like keystrokes. The limit stays the
 * server's, so a Mate running an older server takes large pastes too.
 */
export function createTerminalInputQueue() {
  let pending: Promise<void> | null = null;

  const sendChunks = async (data: string, chunks: string[], send: SendTerminalChunk) => {
    const bracketed =
      chunks.length > 1 &&
      data.startsWith(BRACKETED_PASTE_START) &&
      data.endsWith(BRACKETED_PASTE_END);
    for (const [index, chunk] of chunks.entries()) {
      if (await send(chunk)) continue;
      // A program left inside a bracketed paste takes every later key as pasted text.
      if (bracketed && index > 0) await send(BRACKETED_PASTE_END);
      return;
    }
  };

  return (data: string, send: SendTerminalChunk): Promise<void> => {
    const chunks = chunkTerminalWrite(data);
    if (pending === null && chunks.length === 1) return sendChunks(data, chunks, send);
    const run = () => sendChunks(data, chunks, send);
    const current = pending === null ? run() : pending.then(run, run);
    pending = current;
    const settle = () => {
      if (pending === current) pending = null;
    };
    void current.then(settle, settle);
    return current;
  };
}
