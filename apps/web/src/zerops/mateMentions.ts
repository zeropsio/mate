/**
 * A person's other Mates, named with `@` in a Mate's conversation: the composer offers them, the
 * message's context tells the Mate which Mate is meant and how to reach it (`zerops_message_mate`,
 * whose `to` is a projectId), and the person's bubble draws each name as that Mate.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  type HqMateIdentity,
  shownHqMateIdentitiesAtom,
  shownHqPersonFactsAtom,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { sameValue } from "../lib/sameValue";

export type MentionableMate = Pick<
  HqMateIdentity,
  "projectId" | "name" | "project" | "tint" | "shape"
>;

/** The person's own Mates that take a word from them: automated Mates take tasks from outside. */
const ownMatesAtom = Atom.make((get): ReadonlyArray<MentionableMate> => {
  const facts = get(shownHqPersonFactsAtom);
  return Object.values(get(shownHqMateIdentitiesAtom))
    .filter(
      (identity) =>
        facts[identity.projectId]?.mine === true &&
        identity.automated !== true &&
        identity.name.trim() !== "",
    )
    .map(({ projectId, name, project, tint, shape }) => ({ projectId, name, project, tint, shape }))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId));
}).pipe(Atom.withEquality(sameValue), Atom.withLabel("zerops:mentionable-mates"));

const NONE: ReadonlyArray<MentionableMate> = [];

/** The person's other Mates, as a conversation of the Mate of `ownProjectId` names them; none where `offered` is false. */
export function useMentionableMates(
  ownProjectId: string | undefined,
  offered: boolean,
): ReadonlyArray<MentionableMate> {
  const mates = useAtomValue(ownMatesAtom);
  return useMemo(() => {
    if (!offered) return NONE;
    const others = mates.filter((mate) => mate.projectId !== ownProjectId);
    return others.length === 0 ? NONE : others;
  }, [mates, offered, ownProjectId]);
}

/** What a pick writes: `@Name`, or `@"Two Words"` where a name holds a space, as a mention token reads. */
export function mateMentionText(name: string): string {
  return /\s/u.test(name) ? `@"${name}"` : `@${name}`;
}

/** The Mates a typed `@` query names, by name or project, case-insensitively. */
export function mateMenuMatches(
  mates: ReadonlyArray<MentionableMate>,
  query: string,
): ReadonlyArray<MentionableMate> {
  const typed = query.trim().replace(/^"/u, "").toLowerCase();
  if (typed === "") return mates;
  return mates.filter(
    (mate) =>
      mate.name.toLowerCase().includes(typed) ||
      (mate.project?.toLowerCase().includes(typed) ?? false),
  );
}

/** One pattern for a list of Mates, built once per list, read once per piece of text. */
export interface MateMentionMatcher {
  readonly pattern: RegExp;
  readonly byName: ReadonlyMap<string, ReadonlyArray<MentionableMate>>;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The matcher for `mates`; null where there are none to name. */
export function mateMentionMatcher(
  mates: ReadonlyArray<MentionableMate>,
): MateMentionMatcher | null {
  if (mates.length === 0) return null;
  const byName = new Map<string, MentionableMate[]>();
  for (const mate of mates) {
    const key = mate.name.toLowerCase();
    const held = byName.get(key);
    if (held === undefined) byName.set(key, [mate]);
    else held.push(mate);
  }
  // The longest name first, so `@Fia Two` is not read as `@Fia`.
  const names = [...byName.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  // At a word's start, not inside an address; the whole name, ending where a name cannot go on.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_@.-])@(?:"(${names})"|(${names})(?![\\p{L}\\p{N}_-]))`,
    "giu",
  );
  return { pattern, byName };
}

export interface MateMentionPiece {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly mates: ReadonlyArray<MentionableMate>;
}

/** Each `@Name` in `text` that names one of the matcher's Mates, in order. */
export function findMateMentions(
  text: string,
  matcher: MateMentionMatcher | null,
): ReadonlyArray<MateMentionPiece> {
  if (matcher === null || !text.includes("@")) return [];
  const found: MateMentionPiece[] = [];
  for (const match of text.matchAll(matcher.pattern)) {
    const name = (match[1] ?? match[2] ?? "").toLowerCase();
    const mates = matcher.byName.get(name);
    if (mates === undefined) continue;
    const start = match.index ?? 0;
    found.push({ start, end: start + match[0].length, source: match[0], mates });
  }
  return found;
}

/** What the Mate hears of one Mate its person named: who it is and how to ask it. */
export function mateMentionNote(mate: MentionableMate): string {
  const project = mate.project?.trim();
  const where = project ? `, in the project "${project}"` : "";
  return `@${mate.name} is ${mate.name}, another Mate of your person${where} (projectId ${mate.projectId}). To ask it something, use zerops_message_mate with to set to that projectId.`;
}

/**
 * A line for each Mate the person's words name with `@`, each Mate once, in the order named. Two
 * Mates of one name both get a line: the Mate asks which one is meant.
 */
export function mateMentionNotes(
  text: string,
  mates: ReadonlyArray<MentionableMate>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const notes: string[] = [];
  for (const piece of findMateMentions(text, mateMentionMatcher(mates))) {
    for (const mate of piece.mates) {
      if (seen.has(mate.projectId)) continue;
      seen.add(mate.projectId);
      notes.push(mateMentionNote(mate));
    }
  }
  return notes;
}
