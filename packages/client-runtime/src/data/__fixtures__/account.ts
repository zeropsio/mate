/**
 * Inputs that bring an account's streams up and its scopes to a committed baseline, the way the
 * adapters would: for projection and publication tests that start from a known account.
 */
import { linkKeys, type LinkKey, type ScopeKey } from "../model.ts";
import type { AccountInput, Row } from "../reducer.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { runningScope, type ProcessValue } from "../families/process.ts";

export const ORG = "org";

const event = (key: LinkKey | ScopeKey, streamEvent: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event: streamEvent,
});

/** A link demanded and open, and each scope's first attempt baselined and live. */
function liveScopes(
  link: LinkKey,
  scopes: ReadonlyArray<{
    readonly scope: ScopeKey;
    readonly via: "zerops-realtime";
    readonly members: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<Row>;
  }>,
): ReadonlyArray<AccountInput> {
  return [
    event(link, { kind: "demand", demanded: true }),
    event(link, { kind: "handshake" }),
    event(link, { kind: "baseline-committed" }),
    ...scopes.flatMap(({ scope, via, members, rows }): AccountInput[] => [
      event(scope, { kind: "demand", demanded: true }),
      event(scope, { kind: "attempt" }),
      event(scope, { kind: "handshake" }),
      { kind: "baseline-begin", scope, generation: 1 },
      { kind: "baseline-commit", scope, generation: 1, via, members, rows },
      event(scope, { kind: "baseline-committed" }),
    ]),
  ];
}

/** A process as its whole row reads: what a test does not name is a plain deploy. */
export const processValue = (
  patch: Pick<ProcessValue, "id" | "projectId"> & Partial<ProcessValue>,
): ProcessValue => ({
  serviceStackIds: [],
  status: "RUNNING",
  actionName: "stack.deploy",
  created: "2026-10-05T18:49:08Z",
  ...patch,
});

export const zeropsVersion = (version: number) => ({ kind: "zerops" as const, version });

export function liveZerops(input: {
  readonly running: ReadonlyArray<Parameters<typeof processValue>[0]>;
}): ReadonlyArray<AccountInput> {
  return liveScopes(linkKeys.zerops(ORG), [
    {
      scope: runningScope(ORG),
      via: "zerops-realtime",
      members: input.running.map((process) => process.id),
      rows: input.running.map((process) => ({
        family: "process",
        id: process.id,
        value: processValue(process),
        revision: zeropsVersion(1),
      })),
    },
  ]);
}
