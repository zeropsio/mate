/**
 * What a Mate is told of the MCP servers the person added from its proposal cards in this tab:
 * each server's newest line (`mcpTurnNote`) not yet told, carried by the next message. A line once
 * told is not told again; a server that then stands differently is. A server this tab did not add
 * is never told: its card says how it stands, and the agent added nothing.
 *
 * Pure: no network, no clock.
 */

export interface McpNotes {
  /** The servers this tab added, by name. */
  readonly added: ReadonlyArray<string>;
  /** The newest line per server, not yet told. */
  readonly pending: Readonly<Record<string, string>>;
  /** The last line told per server. */
  readonly told: Readonly<Record<string, string>>;
}

export type McpNoteEvent =
  | { readonly kind: "added"; readonly name: string }
  | { readonly kind: "seen"; readonly name: string; readonly line: string }
  | { readonly kind: "told"; readonly lines: ReadonlyArray<string> };

export const MCP_NOTES_START: McpNotes = { added: [], pending: {}, told: {} };

export function mcpNoteStep(notes: McpNotes, event: McpNoteEvent): McpNotes {
  switch (event.kind) {
    case "added":
      return notes.added.includes(event.name)
        ? notes
        : { ...notes, added: [...notes.added, event.name] };
    case "seen": {
      if (!notes.added.includes(event.name) || notes.pending[event.name] === event.line) {
        return notes;
      }
      const { [event.name]: _dropped, ...rest } = notes.pending;
      if (notes.told[event.name] === event.line) return { ...notes, pending: rest };
      return { ...notes, pending: { ...rest, [event.name]: event.line } };
    }
    case "told": {
      const sent = new Set(event.lines);
      const pending: Record<string, string> = {};
      const told: Record<string, string> = { ...notes.told };
      for (const [name, line] of Object.entries(notes.pending)) {
        if (sent.has(line)) told[name] = line;
        else pending[name] = line;
      }
      return { ...notes, pending, told };
    }
  }
}

/** The lines the next message carries. */
export function mcpNoteLines(notes: McpNotes): ReadonlyArray<string> {
  return Object.values(notes.pending);
}
