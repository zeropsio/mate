import { TERMINAL_WRITE_MAX_LENGTH } from "@t3tools/contracts";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
// A cut this soon after an ESC may split its sequence, and Vim's key-code timeout misses the
// halves (a split closing paste marker leaves it pasting). Escape sequences in input are short.
const ESCAPE_LOOKBACK = 16;

/** One write's outcome; `stopped` means it was not sent because its shell is gone. */
export type TerminalChunkResult = "sent" | "failed" | "stopped";

export interface TerminalInput {
  readonly data: string;
  /** Sends one write to the shell the input was typed into. */
  readonly send: (chunk: string) => Promise<TerminalChunkResult>;
  /** Closes a paste left open in that same shell; false while it cannot be done yet. */
  readonly closePaste: () => Promise<boolean>;
  /** The rest of the input was dropped. */
  readonly interrupted: () => void;
}

/** Splits input into writes that fit one `terminal.write`, never inside an escape sequence. */
export function chunkTerminalWrite(data: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + TERMINAL_WRITE_MAX_LENGTH, data.length);
    if (end < data.length) {
      const escape = data.lastIndexOf("\x1b", end - 1);
      if (escape > start && escape >= end - ESCAPE_LOOKBACK) end = escape;
      const last = data.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Orders one terminal surface's input. Input longer than one write goes a chunk per round trip
 * and later input waits behind it; everything else goes out at once, like keystrokes. A bracketed
 * paste cut short holds later input back until its shell has the closing marker, so keys never
 * land inside a paste. The limit stays the server's, so older Mate servers take large pastes too.
 */
export function createTerminalInputQueue() {
  let pending: Promise<void> | null = null;
  let disposed = false;
  let openPaste: (() => Promise<boolean>) | null = null;
  let closing: Promise<boolean> | null = null;

  const closeOpenPaste = (): Promise<boolean> => {
    if (openPaste === null) return Promise.resolve(true);
    const close = openPaste;
    closing ??= close()
      .catch(() => false)
      .then((closed) => {
        closing = null;
        if (closed && openPaste === close) openPaste = null;
        return closed;
      });
    return closing;
  };

  const run = async (input: TerminalInput, chunks: string[]) => {
    if (!(await closeOpenPaste())) {
      input.interrupted();
      return;
    }
    const bracketed =
      chunks.length > 1 &&
      input.data.startsWith(BRACKETED_PASTE_START) &&
      input.data.endsWith(BRACKETED_PASTE_END);
    let opened = false;
    for (const chunk of chunks) {
      const result = disposed ? "stopped" : await input.send(chunk);
      if (result === "sent") {
        opened = bracketed;
        continue;
      }
      // A failed write may still have reached the shell.
      if (result === "failed") opened = bracketed;
      if (opened) {
        openPaste = input.closePaste;
        await closeOpenPaste();
      }
      if (chunks.length > 1) input.interrupted();
      return;
    }
  };

  const chain = (task: () => Promise<unknown>): Promise<void> => {
    const step = () => task().then(() => undefined);
    const current = pending === null ? step() : pending.then(step, step);
    pending = current;
    const settle = () => {
      if (pending === current) pending = null;
    };
    void current.then(settle, settle);
    return current;
  };

  return {
    enqueue(input: TerminalInput): Promise<void> {
      if (disposed) return Promise.resolve();
      const chunks = chunkTerminalWrite(input.data);
      if (pending === null && openPaste === null && chunks.length === 1) return run(input, chunks);
      return chain(() => run(input, chunks));
    },
    /** Tries again to close a paste left open, as when its shell is reachable again. */
    retryClosePaste(): void {
      if (openPaste !== null && closing === null && pending === null) void chain(closeOpenPaste);
    },
    /** Stops sending; a paste this left open gets one attempt at its closing marker. */
    dispose(): void {
      disposed = true;
      void closeOpenPaste();
    },
  };
}
