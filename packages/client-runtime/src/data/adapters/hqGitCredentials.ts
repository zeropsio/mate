/** The credential view holds list demand; receipts survive closing it, passwords do not. */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { GitCredential } from "@t3tools/shared/hqGit";
import type { HqApi } from "../../zerops/hq/client.ts";
import { gitCredentialsId, type GitCredentialsKey } from "../families/hqGitCredentials.ts";
import { makeGitCredentialExecutor } from "../operations/executors/hqGitCredentials.ts";
import { makeOperations } from "../operations/coordinator.ts";
import { makeGitCredentialReads } from "./hqGitCredentialReads.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
export function makeGitCredentials(options: {
  readonly store: AccountStore;
  readonly api: Pick<HqApi, "gitCredentials" | "issueGitCredential" | "revokeGitCredential">;
  readonly makeId: () => string;
}) {
  const { store } = options;
  let closed = false;
  const reads = makeGitCredentialReads(store, options.api);
  const publish = (key: GitCredentialsKey, requestId: string, credential: GitCredential | null) => {
    if (closed) return;
    const id = gitCredentialsId(key);
    const scope = `hq:${key.orgId}:git-credential-request:${id}` as const;
    const now = Effect.runSync(Clock.currentTimeMillis);
    for (const event of [
      { kind: "demand", demanded: true },
      { kind: "attempt" },
      { kind: "handshake" },
    ] as const)
      store.dispatch({ kind: "stream", key: scope, now, event });
    const generation = streamOf(store.state(), scope).generation;
    const prior = store.state().facts.get(`hqGitCredentialRequest:${id}`)?.revision;
    const sequence = prior?.kind === "mate-link" ? prior.sequence + 1 : 1;
    store.dispatch({ kind: "baseline-begin", scope, generation });
    store.dispatch({
      kind: "baseline-commit",
      scope,
      generation,
      via: "hq-stream",
      members: [id],
      rows: [
        {
          family: "hqGitCredentialRequest",
          id,
          value: { requestId, credential },
          revision: { kind: "mate-link", sequence },
        },
      ],
    });
    store.dispatch({ kind: "stream", key: scope, now, event: { kind: "baseline-committed" } });
  };
  const revealed = new Map<
    string,
    { readonly key: GitCredentialsKey; readonly generation: number }
  >();
  const views = new Map<string, number>();
  const epochs = new Map<string, number>();
  const operations = makeOperations({
    store,
    makeId: options.makeId,
    executors: {
      hq: makeGitCredentialExecutor({
        api: options.api,
        current: () => !closed,
        revealed: (requestId, credential) => {
          const held = revealed.get(requestId);
          if (
            held !== undefined &&
            (views.get(gitCredentialsId(held.key)) ?? 0) > 0 &&
            held.generation === (epochs.get(gitCredentialsId(held.key)) ?? 0)
          )
            publish(held.key, requestId, credential);
        },
      }),
    },
  });
  const act = async (key: GitCredentialsKey, id?: string) => {
    if (closed) return;
    const identity = gitCredentialsId(key);
    const request = readsOfState(store.state()).fact("hqGitCredentialRequest", identity);
    if (request.kind === "known") {
      const record = store.state().operations.get(request.value.requestId);
      // A remount or double click cannot issue another key while the original answer is unknown.
      if (
        id === undefined &&
        record !== undefined &&
        (record.receipt === null ||
          record.submission === "uncertain" ||
          record.submission === "uncertain-unasked")
      )
        return;
    }
    const keepUnresolved =
      id !== undefined &&
      request.kind === "known" &&
      ["uncertain", "uncertain-unasked"].includes(
        store.state().operations.get(request.value.requestId)?.submission ?? "",
      );
    for (const record of store.state().operations.values()) {
      if (
        id !== undefined &&
        record.intent.kind === "revoke-git-credential" &&
        record.intent.appId === key.appId &&
        record.intent.orgId === key.orgId &&
        record.intent.id === id &&
        record.receipt === null &&
        ["recorded", "uncertain", "uncertain-unasked"].includes(record.submission)
      )
        return;
    }
    const requestId = options.makeId();
    if (!keepUnresolved) publish(key, requestId, null);
    revealed.set(requestId, { key, generation: epochs.get(identity) ?? 0 });
    await Effect.runPromise(
      operations.submit(
        id === undefined
          ? { kind: "issue-git-credential", ...key }
          : { kind: "revoke-git-credential", ...key, id },
        requestId,
      ),
    );
    revealed.delete(requestId);
    if (closed) return;
    // The list itself comes from HQ, including effects of writes whose answer was lost.
    const release = reads.demand(key);
    reads.again(key);
    // This hold ends on the first subsequent owner answer or refusal, never on elapsed time.
    const scope = `hq:${key.orgId}:git-credentials:${identity}` as const;
    const stop = store.subscribe(() => {
      const phase = streamOf(store.state(), scope).phase;
      if (!["live", "refused", "recovering"].includes(phase)) return;
      stop();
      release();
    });
  };
  return {
    demand: (key: GitCredentialsKey) => {
      const id = gitCredentialsId(key);
      views.set(id, (views.get(id) ?? 0) + 1);
      const release = reads.demand(key);
      return () => {
        release();
        const count = (views.get(id) ?? 1) - 1;
        views.set(id, count);
        if (count > 0 || closed) return;
        epochs.set(id, (epochs.get(id) ?? 0) + 1);
        const fact = readsOfState(store.state()).fact("hqGitCredentialRequest", id);
        if (fact.kind === "known") publish(key, fact.value.requestId, null);
      };
    },
    issue: (key: GitCredentialsKey) => act(key),
    revoke: (key: GitCredentialsKey, id: string) => act(key, id),
    again: reads.again,
    close: () => {
      if (closed) return;
      for (const identity of views.keys()) {
        const fact = readsOfState(store.state()).fact("hqGitCredentialRequest", identity);
        if (fact.kind === "known" && fact.value.credential !== null) {
          const [orgId, appId] = JSON.parse(identity) as [string, string];
          publish({ orgId, appId }, fact.value.requestId, null);
        }
      }
      closed = true;
      revealed.clear();
      views.clear();
      epochs.clear();
      reads.close();
    },
  };
}
