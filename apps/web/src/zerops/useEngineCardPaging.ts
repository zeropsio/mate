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

/** A conversation's cards not held whole, by the turn each draws. */
export function useEngineCardSnapshots(threadRef: ScopedThreadRef | null) {
  const host = useAtomValue(mateEngineHostAtom);
  const environmentId = threadRef?.environmentId ?? null;
  const conversationId = threadRef?.threadId ?? null;
  const cards = useAtomValue(
    host === null || environmentId === null || conversationId === null
      ? NO_CARDS
      : host.store.data.project(engineCardPaging, { environmentId, conversationId }),
  );
  return cards;
}

/** Execute the assembled card's paging intent; coverage is joined by the timeline. */
export function useEngineCardPages(paging: EngineCardPaging | null): ScrollPages | null {
  const host = useAtomValue(mateEngineHostAtom);
  const threadRef = use(TimelineRowCtx).threadRef;
  const environmentId = threadRef?.environmentId ?? null;
  const conversationId = threadRef?.threadId ?? null;
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
            earlier: paging.since !== null,
            later: paging.through !== null,
            reading: paging.reading !== null,
            read,
          },
    [paging, read],
  );
}
