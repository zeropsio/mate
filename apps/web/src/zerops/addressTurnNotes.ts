/**
 * What a Mate's conversation hears when the addresses its application's production or stage
 * answers on change (`servedAddressNote`), with the next message, once.
 *
 * What a conversation was last told is kept per conversation and place: in account storage as a
 * digest of each address, so a reload remembers it without keeping a platform fact in browser
 * storage, and in memory with the addresses themselves, so a gone one is named while this tab
 * holds it. A place first seen in a conversation is what it knows: nothing is said of it then.
 */
import { fitContextLine } from "@t3tools/client-runtime/data";
import {
  servedAddressAdvice,
  servedAddressNote,
  servedUrls,
  type ServedPlace,
} from "@t3tools/client-runtime/zerops";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";

import { fnv1a32 } from "../lib/diffPresentation";
import { accountLocalStorage } from "./accountLifetime";
import { usePlaceAddresses } from "./ownDomain";
import { useZeropsServedPlaces } from "./useZeropsChangeLandedEvents";

/** What a conversation was told of one place: each address's digest, and the addresses held. */
interface Told {
  readonly keys: ReadonlyArray<string>;
  readonly urls: ReadonlyArray<string>;
}

type ConversationTold = Readonly<Record<string, Told>>;

const KEY = "mate:told-addresses";
/** The conversations remembered, newest last: older ones are told afresh from what they show. */
const KEPT_CONVERSATIONS = 200;
const Stored = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Schema.String))),
);
const decodeStored = Schema.decodeUnknownSync(Stored);
const encodeStored = Schema.encodeSync(Stored);

const readStored = () => {
  try {
    return decodeStored(accountLocalStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};

const keyOf = (url: string) => fnv1a32(url).toString(36);

const useToldStore = create<Readonly<Record<string, ConversationTold>>>()(() => ({}));

/** A conversation's record: this tab's, else the one storage kept, its addresses unnamed. */
function toldIn(threadKey: string): ConversationTold {
  const held = useToldStore.getState()[threadKey];
  if (held !== undefined) return held;
  const kept = readStored()[threadKey] ?? {};
  return Object.fromEntries(
    Object.entries(kept).map(([projectId, keys]) => [projectId, { keys, urls: [] }]),
  );
}

/** The conversation was told, or first saw, that these places answer on these addresses. */
function remember(threadKey: string, places: Readonly<Record<string, ReadonlyArray<string>>>) {
  const told = toldIn(threadKey);
  const next: Record<string, Told> = { ...told };
  for (const [projectId, urls] of Object.entries(places))
    next[projectId] = { keys: urls.map(keyOf), urls };
  useToldStore.setState((state) => ({ ...state, [threadKey]: next }));
  try {
    const { [threadKey]: _previous, ...others } = readStored();
    const kept = Object.entries(others).slice(-(KEPT_CONVERSATIONS - 1));
    const keys = Object.fromEntries(
      Object.entries(next).map(([projectId, entry]) => [projectId, [...entry.keys]]),
    );
    accountLocalStorage.setItem(
      KEY,
      encodeStored({ ...Object.fromEntries(kept), [threadKey]: keys }),
    );
  } catch {
    /* Blocked storage keeps it for this tab only. */
  }
}

interface AddressTurnNotes {
  /** What the next message tells. */
  readonly lines: ReadonlyArray<string>;
  /** A message carried these. */
  readonly told: (lines: ReadonlyArray<string>) => void;
}

const NO_LINES: ReadonlyArray<string> = [];

/** The addresses a place answers on, or `undefined` while it is unread or there is none. */
function useServed(place: ServedPlace | undefined): ReadonlyArray<string> | undefined {
  const addresses = usePlaceAddresses(place?.projectId);
  const urls = useMemo(() => servedUrls(addresses), [addresses]);
  const joined = urls?.join("\n");
  // Held by what it says, so a read that changes nothing of it asks nothing again.
  return useMemo(
    () => (joined === undefined ? undefined : joined.split("\n").filter(Boolean)),
    [joined],
  );
}

export function useAddressTurnNotes(
  environmentId: string | null,
  threadKey: string | null,
): AddressTurnNotes {
  const places = useZeropsServedPlaces(environmentId);
  const production = places.find((place) => place.tier === "production");
  const stage = places.find((place) => place.tier === "stage");
  const productionUrls = useServed(production);
  const stageUrls = useServed(stage);
  const held = useToldStore((state) => (threadKey === null ? undefined : state[threadKey]));
  const served = useMemo(
    () =>
      [
        { place: production, urls: productionUrls },
        { place: stage, urls: stageUrls },
      ].flatMap(({ place, urls }) =>
        place === undefined || urls === undefined ? [] : [{ place, urls }],
      ),
    [production, productionUrls, stage, stageUrls],
  );
  // A place this conversation has not seen yet is what it knows.
  useEffect(() => {
    if (threadKey === null) return;
    const told = toldIn(threadKey);
    const unseen = served.filter(({ place }) => told[place.projectId] === undefined);
    if (unseen.length > 0)
      remember(
        threadKey,
        Object.fromEntries(unseen.map(({ place, urls }) => [place.projectId, urls])),
      );
  }, [served, threadKey]);
  const notes = useMemo(() => {
    if (threadKey === null) return [];
    const told = held ?? toldIn(threadKey);
    return served.flatMap(({ place, urls }) => {
      const before = told[place.projectId];
      if (before === undefined) return [];
      const line = servedAddressNote(
        place.label,
        { keys: new Set(before.keys), urls: before.urls },
        urls,
        keyOf,
      );
      return line === undefined ? [] : [{ line: fitContextLine(line), place, urls }];
    });
  }, [held, served, threadKey]);
  const lines = useMemo(
    () =>
      notes.length === 0
        ? NO_LINES
        : [
            ...notes.map((note) => note.line),
            servedAddressAdvice(notes.map((note) => note.place.tier)),
          ],
    [notes],
  );
  const told = useCallback(
    (sent: ReadonlyArray<string>) => {
      if (threadKey === null) return;
      const carried = notes.filter((note) => sent.includes(note.line));
      if (carried.length > 0)
        remember(
          threadKey,
          Object.fromEntries(carried.map(({ place, urls }) => [place.projectId, urls])),
        );
    },
    [notes, threadKey],
  );
  return { lines, told };
}
