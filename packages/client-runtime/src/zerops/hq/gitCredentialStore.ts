/** Account-owned metadata and the visible outcome of one credential command. Passwords stay in memory. */
import type { GitCredential, GitCredentialRecord } from "@t3tools/shared/hqGit";
import { advance, newCell, read, type Shown } from "../knowledge/known.ts";

export type GitCredentialAction =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly verb: "issue" | "revoke" }
  | { readonly kind: "issued"; readonly credential: GitCredential }
  | { readonly kind: "failed"; readonly words: string };
export interface GitCredentialSnapshot {
  readonly credentials: Shown<ReadonlyArray<GitCredentialRecord>>;
  readonly action: GitCredentialAction;
}
/** The password list's render model; unread and failed lists never become empty records. */
export function selectGitCredentials(snapshot: GitCredentialSnapshot) {
  const shown = snapshot.credentials;
  const credentials =
    shown.state === "known"
      ? {
          state: shown.state,
          records: shown.value,
          partial: shown.coverage === "partial",
          stale: shown.freshness.kind === "stale",
        }
      : shown.state === "failed"
        ? {
            state: shown.state,
            words:
              shown.failure.kind === "refused"
                ? shown.failure.words
                : "HQ could not read the password list.",
          }
        : { state: shown.state };
  return { action: snapshot.action, credentials };
}

export function makeGitCredentialStore(input: {
  readonly list: () => Promise<ReadonlyArray<GitCredentialRecord>>;
  readonly issue: () => Promise<GitCredential>;
  readonly revoke: (id: string) => Promise<void>;
  readonly now: () => number;
}) {
  let cell = newCell<ReadonlyArray<GitCredentialRecord>>("account");
  let action: GitCredentialAction = { kind: "idle" };
  let snapshot: GitCredentialSnapshot = { credentials: read(cell), action };
  const listeners = new Set<() => void>();
  let ordinal = 0;
  let closed = false;
  let passwordGeneration = 0;
  let loading: Promise<void> | null = null;
  let commanding: Promise<GitCredentialAction> | null = null;
  const words = (cause: unknown) =>
    cause instanceof Error ? cause.message : "HQ could not finish this attempt.";
  const publish = () => {
    snapshot = { credentials: read(cell), action };
    for (const listener of listeners) listener();
  };
  const records = () => {
    if (cell.held.state === "known") return cell.held.value;
    return undefined;
  };
  const hold = (value: ReadonlyArray<GitCredentialRecord>, coverage: "complete" | "partial") => {
    cell = advance(
      cell,
      { kind: "pushed", ordinal: ++ordinal, atMs: input.now(), value, coverage },
      input.now(),
    );
  };
  const load = (again = false): Promise<void> => {
    if (closed) return Promise.resolve();
    if (loading !== null) return loading;
    if (!again && cell.held.state !== "unread") return Promise.resolve();
    const ticket = ++ordinal;
    cell = advance(cell, { kind: "read-started", ordinal: ticket, atMs: input.now() }, input.now());
    loading = input
      .list()
      .then(
        (value) => {
          if (!closed)
            cell = advance(
              cell,
              {
                kind: "read-succeeded",
                ordinal: ticket,
                atMs: input.now(),
                value,
                coverage: "complete",
              },
              input.now(),
            );
        },
        (cause: unknown) => {
          if (!closed)
            cell = advance(
              cell,
              {
                kind: "read-failed",
                ordinal: ticket,
                retryAtMs: null,
                failure: { kind: "refused", code: "git_credentials", words: words(cause) },
              },
              input.now(),
            );
        },
      )
      .finally(() => {
        loading = null;
        if (!closed) publish();
      });
    publish();
    return loading;
  };
  const command = (verb: "issue" | "revoke", id?: string): Promise<GitCredentialAction> => {
    if (closed) return Promise.resolve(action);
    if (commanding !== null) return commanding;
    const generation = passwordGeneration;
    action = { kind: "working", verb };
    commanding = (
      verb === "issue"
        ? input.issue().then((credential) => {
            if (closed) return action;
            const { id, appId, createdAt, expiresAt } = credential;
            const record = { id, appId, createdAt, expiresAt };
            const previous = records();
            const complete = cell.held.state === "known" && cell.held.coverage === "complete";
            hold(
              previous === undefined
                ? [record]
                : [record, ...previous.filter((old) => old.id !== id)],
              complete ? "complete" : "partial",
            );
            action =
              generation === passwordGeneration ? { kind: "issued", credential } : { kind: "idle" };
            return action;
          })
        : input.revoke(id!).then(() => {
            if (closed) return action;
            const previous = records();
            if (previous !== undefined)
              hold(
                previous.filter((record) => record.id !== id),
                cell.held.state === "known" ? cell.held.coverage : "partial",
              );
            action = { kind: "idle" };
            return action;
          })
    )
      .catch((cause: unknown) => {
        if (!closed) action = { kind: "failed", words: words(cause) };
        return action;
      })
      .finally(() => {
        commanding = null;
        if (!closed) publish();
      });
    publish();
    return commanding;
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: () => load(),
    again: () => load(true),
    issue: () => command("issue"),
    revoke: (id: string) => command("revoke", id),
    forgetPassword: () => {
      passwordGeneration++;
      if (action.kind === "issued") {
        action = { kind: "idle" };
        publish();
      }
    },
    close: () => {
      closed = true;
      passwordGeneration++;
      cell = newCell("account");
      action = { kind: "idle" };
      publish();
    },
  };
}
