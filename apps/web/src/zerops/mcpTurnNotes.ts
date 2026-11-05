/**
 * What a Mate hears of the MCP servers the person added from its proposal cards, with the next
 * message (`mcpTurnNotes.logic.ts`), per Mate. Memory only: the lines name servers and agents,
 * never a key.
 */
import { fitContextLine } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";
import { create } from "zustand";

import {
  MCP_NOTES_START,
  mcpNoteLines,
  mcpNoteStep,
  type McpNoteEvent,
  type McpNotes,
} from "./mcpTurnNotes.logic";

const useMcpNotesStore = create<Readonly<Record<string, McpNotes>>>()(() => ({}));

const NO_LINES: ReadonlyArray<string> = [];

/** A step for one Mate's notes: a server added from a card, how it stands now, or lines told. */
export function noteMcp(environmentId: EnvironmentId, event: McpNoteEvent): void {
  // Fitted as a send fits it, so the line a message carried is the one marked told.
  const fitted = event.kind === "seen" ? { ...event, line: fitContextLine(event.line) } : event;
  useMcpNotesStore.setState((state) => {
    const before = state[environmentId] ?? MCP_NOTES_START;
    const after = mcpNoteStep(before, fitted);
    return after === before ? state : { ...state, [environmentId]: after };
  });
}

export interface McpTurnNotes {
  /** What the next message tells. */
  readonly lines: ReadonlyArray<string>;
  /** A message carried these. */
  readonly told: (lines: ReadonlyArray<string>) => void;
}

export function useMcpTurnNotes(environmentId: EnvironmentId | null): McpTurnNotes {
  const notes = useMcpNotesStore((state) =>
    environmentId === null ? undefined : state[environmentId],
  );
  const lines = useMemo(() => (notes === undefined ? NO_LINES : mcpNoteLines(notes)), [notes]);
  const told = useCallback(
    (sent: ReadonlyArray<string>) => {
      if (environmentId !== null && sent.length > 0) {
        noteMcp(environmentId, { kind: "told", lines: sent });
      }
    },
    [environmentId],
  );
  return { lines, told };
}
