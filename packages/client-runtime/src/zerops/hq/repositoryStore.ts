/** One account's source facts. Reads never retry themselves; Again starts one new attempt. */
import type { RepositoryQuery, RepositorySource } from "@t3tools/shared/hqGit";
import { advance, newCell, read, type Cell, type Shown } from "../knowledge/known.ts";
import { HqError } from "./client.ts";

export interface RepositoryTarget {
  readonly appId: string;
  readonly repo: string;
  readonly query: RepositoryQuery;
}
export const repositoryKey = ({ appId, repo, query }: RepositoryTarget) =>
  JSON.stringify([appId, repo, query.rev ?? null, query.path, query.kind]);

export function makeRepositoryStore(input: {
  readonly read: (target: RepositoryTarget, signal: AbortSignal) => Promise<RepositorySource>;
  readonly now: () => number;
}) {
  interface Entry {
    cell: Cell<RepositorySource>;
    shown: Shown<RepositorySource>;
    pending: Promise<void> | null;
    readonly abort: AbortController;
    readonly listeners: Set<() => void>;
  }
  const entries = new Map<string, Entry>();
  let ordinal = 0;
  let closed = false;
  const entryFor = (target: RepositoryTarget): Entry => {
    const key = repositoryKey(target);
    let entry = entries.get(key);
    if (entry === undefined) {
      const cell = newCell<RepositorySource>("account");
      entry = {
        cell,
        shown: read(cell),
        pending: null,
        abort: new AbortController(),
        listeners: new Set(),
      };
      entries.set(key, entry);
    }
    return entry;
  };
  const publish = (entry: Entry) => {
    entry.shown = read(entry.cell);
    for (const listener of entry.listeners) listener();
  };
  const trim = () => {
    for (const [key, entry] of entries) {
      if (entries.size <= 32) return;
      if (entry.listeners.size === 0 && entry.pending === null) entries.delete(key);
    }
  };
  const attempt = (target: RepositoryTarget, again: boolean): Promise<void> => {
    if (closed) return Promise.resolve();
    const entry = entryFor(target);
    if (entry.pending !== null) return entry.pending;
    if (!again && entry.cell.held.state !== "unread") return Promise.resolve();
    const ticket = ++ordinal;
    entry.cell = advance(
      entry.cell,
      { kind: "read-started", ordinal: ticket, atMs: input.now() },
      input.now(),
    );
    const pending = input
      .read(target, entry.abort.signal)
      .then(
        (value) => {
          if (closed) return;
          entry.cell = advance(entry.cell, { kind: "restore-authority" }, input.now());
          entry.cell = advance(
            entry.cell,
            {
              kind: "read-succeeded",
              ordinal: ticket,
              value,
              coverage: value.truncated || value.branchesTruncated ? "partial" : "complete",
              atMs: input.now(),
            },
            input.now(),
          );
        },
        (cause: unknown) => {
          if (closed) return;
          const words =
            cause instanceof Error ? cause.message : "HQ could not read this repository.";
          entry.cell = advance(
            entry.cell,
            {
              kind: "read-failed",
              ordinal: ticket,
              retryAtMs: null,
              failure: {
                kind: "refused",
                code: cause instanceof HqError ? cause.code : "network",
                words,
              },
            },
            input.now(),
          );
          if (
            cause instanceof HqError &&
            (cause.code === "forbidden" || cause.code === "session_required")
          ) {
            entry.cell = advance(
              entry.cell,
              { kind: "withhold", reason: "access-denied", cause: null },
              input.now(),
            );
          }
        },
      )
      .finally(() => {
        entry.pending = null;
        if (!closed) {
          publish(entry);
          trim();
        }
      });
    entry.pending = pending;
    publish(entry);
    return pending;
  };
  return {
    snapshot: (target: RepositoryTarget) => entryFor(target).shown,
    subscribe: (target: RepositoryTarget, listener: () => void) => {
      const entry = entryFor(target);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        trim();
      };
    },
    load: (target: RepositoryTarget) => attempt(target, false),
    again: (target: RepositoryTarget) => attempt(target, true),
    close: () => {
      closed = true;
      for (const entry of entries.values()) entry.abort.abort();
      entries.clear();
    },
  };
}
