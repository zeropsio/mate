/**
 * What an engine Mate's card holds of a run too long to read whole (`engineCardPaging`), read
 * where the card is drawn, and how its scroll reads the next page. A V1 Mate's card, and an
 * engine card read whole, holds no paging: it draws as it always has.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  engineCardPaging,
  mateEngineHostAtom,
  type EngineCardPaging,
} from "@t3tools/client-runtime/data";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { use, useCallback, useMemo } from "react";

import { TimelineRowCtx } from "../components/chat/timelineContext";
import type { ScrollPages } from "./engineCardPaging.logic";

const NO_CARDS = Atom.make<Readonly<Record<string, EngineCardPaging>>>({});

export interface CardPaging {
  readonly paging: EngineCardPaging;
  readonly pages: ScrollPages;
}

/** A conversation's cards not held whole, by the turn each draws. */
function useCards(threadRef: ScopedThreadRef | null) {
  const host = useAtomValue(mateEngineHostAtom);
  const environmentId = threadRef?.environmentId ?? null;
  const conversationId = threadRef?.threadId ?? null;
  const cards = useAtomValue(
    host === null || environmentId === null || conversationId === null
      ? NO_CARDS
      : host.store.data.project(engineCardPaging, { environmentId, conversationId }),
  );
  return { host, environmentId, conversationId, cards };
}

/**
 * The turns of a conversation whose work its account does not hold whole, each still a card
 * (`deriveMessagesTimelineRows`' `unheldWork`); none for a V1 Mate's.
 */
export function useEngineUnheldWork(
  threadRef: ScopedThreadRef | null,
): ReadonlySet<string> | undefined {
  const { cards } = useCards(threadRef);
  return useMemo(() => {
    const turns = Object.entries(cards).flatMap(([turnId, card]) => (card.hasWork ? [turnId] : []));
    return turns.length === 0 ? undefined : new Set(turns);
  }, [cards]);
}

/** The card of turn `turnId` as its run's paging holds it; null when it is held whole. */
export function useEngineCardPaging(turnId: string | null): CardPaging | null {
  const { host, environmentId, conversationId, cards } = useCards(use(TimelineRowCtx).threadRef);
  const paging = turnId === null ? null : (cards[turnId] ?? null);
  const earlierRun = paging?.pageRuns.earlier ?? null;
  const laterRun = paging?.pageRuns.later ?? null;
  const read = useCallback(
    (direction: "earlier" | "later") => {
      // A card of several runs reads them in its order: the next page each way is one run's.
      const runId = direction === "earlier" ? earlierRun : laterRun;
      if (host === null || environmentId === null || conversationId === null || runId === null)
        return;
      host.conversations.readRunPage({ environmentId, conversationId }, runId, direction);
    },
    [conversationId, earlierRun, environmentId, host, laterRun],
  );
  return useMemo(
    () =>
      paging === null
        ? null
        : {
            paging,
            pages: {
              earlier: paging.since !== null,
              later: paging.through !== null,
              reading: paging.reading !== null,
              read,
            },
          },
    [paging, read],
  );
}
