/**
 * Which project rows were last drawn risen — needing the person, at the list's top — so a row
 * whose reads are out on a reload stays where it was drawn (`rowRises`) instead of rising a few
 * seconds later. Kept per account in this browser, and forgotten when the account closes.
 */
import { useEffect } from "react";

import { accountLocalStorage, onAccountLifetimeClose } from "~/zerops/accountLifetime";

const RISEN_MEMORY_KEY = "mate:zerops:projects-risen";

let risen: Set<string> | undefined;

function read(): Set<string> {
  if (risen !== undefined) return risen;
  let ids: unknown = [];
  try {
    ids = JSON.parse(accountLocalStorage.getItem(RISEN_MEMORY_KEY) ?? "[]");
  } catch {
    ids = [];
  }
  risen = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  return risen;
}

onAccountLifetimeClose(() => {
  risen = undefined;
  try {
    accountLocalStorage.removeItem(RISEN_MEMORY_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});

/** Whether the row was last drawn risen; `undefined` where it never was drawn known. */
export function lastRowRisen(groupId: string): boolean | undefined {
  return read().has(groupId) ? true : undefined;
}

/** Records the rows drawn risen, once their answers are in (`known`). */
export function useRememberRisenRows(
  rows: ReadonlyArray<{
    readonly groupId: string;
    readonly rises: boolean;
    readonly known: boolean;
  }>,
): void {
  // Written when what is known changes, not on every render.
  const known = rows
    .filter((row) => row.known)
    .map((row) => `${row.groupId}:${row.rises ? 1 : 0}`)
    .join(",");
  useEffect(() => {
    if (known.length === 0) return;
    const next = new Set(read());
    for (const entry of known.split(",")) {
      const at = entry.lastIndexOf(":");
      const groupId = entry.slice(0, at);
      if (entry.slice(at + 1) === "1") next.add(groupId);
      else next.delete(groupId);
    }
    risen = next;
    try {
      accountLocalStorage.setItem(RISEN_MEMORY_KEY, JSON.stringify([...next]));
    } catch {
      // A full or blocked storage remembers nothing; the rows rise when their reads answer.
    }
  }, [known]);
}
