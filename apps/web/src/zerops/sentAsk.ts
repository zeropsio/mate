/**
 * What this browser just sent each Mate, until its conversation says it.
 *
 * The composer clears its draft the moment a message goes; the conversation
 * the menu reads hears of the message a beat later, from the Mate. In between
 * the Mate's row had nothing of the person's to say (live, 2026-10-02: Draft →
 * "Nothing asked yet" → the task, for 0.4 s). The composer notes what it sent
 * here as it clears, and forgets it when the send fails; the row says it until
 * the conversation catches up (`mateRowSentAsk`) and lets it go then. Held at
 * most `SENT_ASK_HOLD_MS`: a conversation that never says it — its socket
 * gone — gets its own words back.
 */
import { create } from "zustand";

import { onAccountLifetimeClose } from "./accountLifetime";

/** How long a sent message is held at most. */
export const SENT_ASK_HOLD_MS = 120_000;

export interface SentAsk {
  readonly messageId: string;
  /** The conversation it went into. */
  readonly threadId: string;
  readonly text: string;
  /** When it was sent: the message's own time. */
  readonly at: string;
}

export interface SentAskState {
  /** By the Mate's environment: one conversation each. */
  readonly byEnvironment: Readonly<Record<string, SentAsk>>;
  readonly note: (environmentId: string, sent: SentAsk) => void;
  /** A send that failed: its words went back to the composer. */
  readonly forget: (environmentId: string, messageId: string) => void;
}

export const useSentAsks = create<SentAskState>((set, get) => ({
  byEnvironment: {},
  note: (environmentId, sent) => {
    set({ byEnvironment: { ...get().byEnvironment, [environmentId]: sent } });
    setTimeout(() => get().forget(environmentId, sent.messageId), SENT_ASK_HOLD_MS);
  },
  forget: (environmentId, messageId) => {
    const { [environmentId]: held, ...rest } = get().byEnvironment;
    if (held?.messageId === messageId) set({ byEnvironment: rest });
  },
}));

onAccountLifetimeClose(() => {
  useSentAsks.setState({ byEnvironment: {} });
});
