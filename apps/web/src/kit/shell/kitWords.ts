import { useEffect, useState } from "react";

import type { NavEntry } from "./kitPages";

/**
 * The words the kit says about each component, for its search: the doc comments in the
 * component's file (the kit's own components) and the notes and headings its kit page writes over
 * its specimens. Read as text, at the first search, in chunks of their own.
 */
const COMPONENT_SOURCES = import.meta.glob<string>("../../components/ui/*.tsx", {
  query: "?raw",
  import: "default",
});
const SECTION_SOURCES = import.meta.glob<string>("../sections/*.tsx", {
  query: "?raw",
  import: "default",
});

/** `apps/web/src/components/ui/x.tsx` as this module's glob names it. */
const sourceKey = (source: string) => source.replace(/^apps\/web\/src\//u, "../../");

/** A source's doc comments, their words only. */
const docComments = (text: string) =>
  [...text.matchAll(/\/\*\*([\s\S]*?)\*\//gu)]
    .map(([, body]) => (body ?? "").replace(/^\s*\*\s?/gmu, ""))
    .join(" ");

/** A kit page's words over its specimens: each block's and specimen's note and title. */
const pageWords = (text: string) =>
  [...text.matchAll(/\b(?:note|title)[=:]\s*\{?\s*["'`]([^"'`]+)["'`]/gu)]
    .map(([, words]) => words ?? "")
    .join(" ");

const read = async (load: (() => Promise<string>) | undefined, pick: (text: string) => string) =>
  load === undefined ? "" : pick(await load());

let loaded: Promise<ReadonlyMap<string, string>> | undefined;

function loadKitWords(entries: readonly NavEntry[]): Promise<ReadonlyMap<string, string>> {
  loaded ??= Promise.all(
    entries
      .filter((entry) => entry.group === "Components")
      .map(async (entry) => {
        const [docs, page] = await Promise.all([
          read(
            entry.source === undefined ? undefined : COMPONENT_SOURCES[sourceKey(entry.source)],
            docComments,
          ),
          read(SECTION_SOURCES[`../sections/${entry.page}.tsx`], pageWords),
        ]);
        return [entry.key, `${docs} ${page}`] as const;
      }),
  ).then((pairs) => new Map(pairs));
  return loaded;
}

/** Each component's words by its entry's key, once `wanted` first turns true; until then none. */
export function useKitWords(
  entries: readonly NavEntry[],
  wanted: boolean,
): ReadonlyMap<string, string> | undefined {
  const [words, setWords] = useState<ReadonlyMap<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!wanted || words !== undefined) return;
    let live = true;
    void loadKitWords(entries).then((next) => {
      if (live) setWords(next);
    });
    return () => {
      live = false;
    };
  }, [entries, wanted, words]);
  return words;
}
