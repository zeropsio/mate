/**
 * This tab's presses on a code repository's remote that HQ's record does not show yet: a connect
 * sent from the picker or a disconnect from the row. The picker and the project page's row read
 * the same press, so closing the dialog mid-connect leaves the row saying the same step, and a
 * disconnect says *Disconnecting…* until the record no longer names the remote. Never a remote
 * fact: the record outranks it the moment it shows the outcome.
 */
import { useSyncExternalStore } from "react";

import type { RepoPress } from "../gitMirror.logic";

type Held = Exclude<RepoPress, null>;

const presses = new Map<string, Held>();
const listeners = new Set<() => void>();
const keyOf = (project: string, repo: string) => JSON.stringify([project, repo]);

function tell() {
  for (const listener of listeners) listener();
}

export function holdPress(project: string, repo: string, press: Held): void {
  presses.set(keyOf(project, repo), press);
  tell();
}

export function releasePress(project: string, repo: string, press: Held): void {
  const key = keyOf(project, repo);
  if (presses.get(key) !== press) return;
  presses.delete(key);
  tell();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The press held for one repository, `null` when none. */
export function useRepoPress(project: string, repo: string): RepoPress {
  return useSyncExternalStore(subscribe, () => presses.get(keyOf(project, repo)) ?? null);
}
