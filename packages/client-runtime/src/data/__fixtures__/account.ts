/**
 * Inputs that bring an account's streams up and its scopes to a committed baseline, the way the
 * adapters would: for projection and publication tests that start from a known account.
 */
import { scopeKeys, type AttentionValue, type LinkKey, type ScopeKey } from "../model.ts";
import type { AccountInput, Row } from "../reducer.ts";
import type { StreamEvent } from "../streamMachine.ts";

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
    readonly via: "zerops-realtime" | "hq-stream" | "mate-direct";
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

export const zeropsVersion = (version: number) => ({ kind: "zerops" as const, version });

export function liveZerops(input: {
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly running?: ReadonlyArray<{ readonly id: string; readonly projectId: string }>;
}): ReadonlyArray<AccountInput> {
  const running = input.running ?? [];
  return liveScopes(scopeKeys.zeropsLink(ORG), [
    {
      scope: scopeKeys.projects(ORG),
      via: "zerops-realtime",
      members: input.projects.map((project) => project.id),
      rows: input.projects.map((project) => ({
        family: "project",
        id: project.id,
        value: { ...project, status: "ACTIVE" },
        revision: zeropsVersion(1),
      })),
    },
    {
      scope: scopeKeys.running(ORG),
      via: "zerops-realtime",
      members: running.map((process) => process.id),
      rows: running.map((process) => ({
        family: "process",
        id: process.id,
        value: { ...process, status: "RUNNING", actionName: "stack.deploy" },
        revision: zeropsVersion(1),
      })),
    },
  ]);
}

export const hqObservation = (sequence: number, generation = 1) => ({
  kind: "hq-observation" as const,
  generation,
  sequence,
});

export const attentionOf = (patch: Partial<AttentionValue> = {}): AttentionValue => ({
  mainChatId: "chat-main",
  latestChatId: "chat-main",
  working: 0,
  waiting: 0,
  resultIds: [],
  questionIds: [],
  truncated: false,
  ...patch,
});

export function liveHq(input: {
  readonly placements: ReadonlyArray<{
    readonly projectId: string;
    readonly appId: string | null;
    readonly role?: string;
  }>;
  readonly attention?: ReadonlyArray<{
    readonly projectId: string;
    readonly value: AttentionValue;
    readonly producer: "up" | "down";
  }>;
}): ReadonlyArray<AccountInput> {
  const attention = input.attention ?? [];
  return liveScopes(scopeKeys.hqLink(ORG), [
    {
      scope: scopeKeys.navigation(ORG),
      via: "hq-stream",
      members: input.placements.map((placement) => placement.projectId),
      rows: [
        ...input.placements.map(({ projectId, appId, role }): Row => ({
          family: "placement",
          id: projectId,
          value:
            appId === null
              ? { kind: "outside" }
              : { kind: "app", appId, appName: `App ${appId}`, role: role ?? "mate" },
          revision: hqObservation(1),
        })),
        ...attention.map(({ projectId, value, producer }): Row => ({
          family: "attention",
          id: projectId,
          value,
          revision: hqObservation(1),
          producer,
        })),
      ],
    },
  ]);
}

/** An open Mate's own attention, its link live. */
export function liveMate(
  projectId: string,
  value: AttentionValue,
  revision: number,
  incarnation = "inc-1",
): ReadonlyArray<AccountInput> {
  return liveScopes(scopeKeys.mateLink(projectId), [
    {
      scope: scopeKeys.attention(projectId),
      via: "mate-direct",
      members: [projectId],
      rows: [
        {
          family: "attention",
          id: projectId,
          value,
          revision: { kind: "mate-attention", incarnation, revision },
        },
      ],
    },
  ]);
}

export const streamEvent = event;
