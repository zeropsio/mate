/**
 * A press on a code repository's remote — a connect from the picker, a disconnect from the row —
 * followed through its operation's own record until HQ's repository record shows the outcome.
 * Only the request id is kept here, per account, so the picker and the project page's row read the
 * same press: closing the dialog mid-connect leaves the row on the same step, and a refusal
 * (`remote_taken`) stays on the row in HQ's words until dismissed or pressed again.
 *
 * Every wait ends: an answer whose outcome the record does not show within `RECORD_DEADLINE_MS`
 * reads as unconfirmed, with what to check.
 */
import { operationProgress, type OperationProgress } from "@t3tools/client-runtime/data";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { Atom } from "effect/reactivity";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useProjection } from "~/zerops/accountData";

import { githubName } from "../gitMirror.logic";

/** One press held for a repository. */
export interface HeldPress {
  readonly kind: "connect" | "disconnect";
  /** The operation's request id; `null` for a token connect, held only while its call runs. */
  readonly requestId: string | null;
  /** Where a connect goes: `owner/name` through an app, the address with a token. */
  readonly target: string | null;
  readonly via: "app" | "token" | null;
  /** The app a connect goes through, as its steps name it. */
  readonly appName: string | null;
}

/** How long HQ's record may lag its answer before the press says it can't confirm the outcome. */
const RECORD_DEADLINE_MS = 30_000;
/** How long HQ may take to answer at all. */
const ANSWER_DEADLINE_MS = 90_000;

const presses = new Map<string, HeldPress>();
const listeners = new Set<() => void>();
const keyOf = (orgId: string | null, project: string, repo: string) =>
  JSON.stringify([orgId, project, repo]);

function tell() {
  for (const listener of listeners) listener();
}

export function holdPress(
  orgId: string | null,
  project: string,
  repo: string,
  press: HeldPress,
): void {
  presses.set(keyOf(orgId, project, repo), press);
  tell();
}

/** Lets the press go — only the one named, where another has replaced it since. */
export function dropPress(
  orgId: string | null,
  project: string,
  repo: string,
  press: HeldPress,
): void {
  const key = keyOf(orgId, project, repo);
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

/** Where a press stands, as the row and the picker say it. */
export type PressState =
  | { readonly kind: "none" }
  /** Sent, and HQ's record does not show its outcome yet. */
  | { readonly kind: "working"; readonly press: HeldPress; readonly answered: boolean }
  /** HQ refused it, in its words. */
  | { readonly kind: "refused"; readonly press: HeldPress; readonly words: string }
  /** Its outcome could not be told: what to check. */
  | { readonly kind: "unconfirmed"; readonly press: HeldPress; readonly words: string };

const UNKNOWN = Atom.make<OperationProgress>({ stage: "unknown" });

/** Whether the repository's record shows the press's outcome. */
export function pressShown(press: HeldPress, entry: RepoListEntry | undefined): boolean {
  if (entry === undefined) return false;
  const remote = entry.remote;
  if (press.kind === "disconnect") return remote == null;
  if (remote == null || press.target === null) return false;
  return press.via === "app"
    ? githubName(remote.url)?.toLowerCase() === press.target.toLowerCase()
    : sameAddress(remote.url, press.target);
}

/** Two remote addresses name one repository: case, `.git` and a trailing slash aside. */
export const sameAddress = (a: string, b: string) => {
  const plain = (url: string) =>
    url
      .trim()
      .replace(/\/+$/u, "")
      .replace(/\.git$/u, "")
      .toLowerCase();
  return plain(a) === plain(b);
};

/** The press held for one repository, followed through its operation and the record. */
export function useRepoPress(
  orgId: string | null,
  project: string,
  repo: string,
  entry: RepoListEntry | undefined,
): PressState {
  const press = useSyncExternalStore(
    subscribe,
    () => presses.get(keyOf(orgId, project, repo)) ?? null,
  );
  const progress = useProjection(operationProgress, press?.requestId ?? null, UNKNOWN);
  const shown = press !== null && pressShown(press, entry);
  const answered =
    progress.stage === "accepted" ||
    progress.stage === "reflected" ||
    (progress.stage === "done" && progress.outcome === "succeeded");
  const [lagging, setLagging] = useState<HeldPress | null>(null);
  // Shown in the record, the press is done: the record says the rest.
  useEffect(() => {
    if (press !== null && shown) dropPress(orgId, project, repo, press);
  }, [orgId, press, project, repo, shown]);
  // Not shown: HQ's answer, then its record, each get a deadline; past it the press can't confirm.
  useEffect(() => {
    if (press === null || shown) return;
    const timer = window.setTimeout(
      () => setLagging(press),
      answered ? RECORD_DEADLINE_MS : ANSWER_DEADLINE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [answered, press, shown]);
  if (press === null || shown) return { kind: "none" };
  const verb = press.kind === "connect" ? "connection" : "disconnect";
  switch (progress.stage) {
    case "refused":
      return { kind: "refused", press, words: progress.reason };
    case "done":
      if (progress.outcome !== "succeeded")
        return {
          kind: "refused",
          press,
          words:
            progress.reason ?? `HQ didn't finish the ${verb}. Check the row before trying again.`,
        };
      break;
    case "unsent":
      return {
        kind: "refused",
        press,
        words: progress.reason ?? `HQ didn't take the ${verb}. Try again.`,
      };
    case "uncertain":
    case "unresolved":
      return {
        kind: "unconfirmed",
        press,
        words: `HQ couldn't confirm the ${verb}. Check the row before trying again.`,
      };
    default:
      break;
  }
  if (lagging === press)
    return {
      kind: "unconfirmed",
      press,
      words: answered
        ? `HQ took the ${verb}, but its record doesn't show it yet. Look again in a moment.`
        : `HQ hasn't answered about the ${verb}. Check the row before trying again.`,
    };
  return { kind: "working", press, answered };
}
