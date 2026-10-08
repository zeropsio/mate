import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/reactivity";
import {
  AGENT_USAGE_REPORT_PROTOCOL,
  type AgentUsageScope,
  type UsageReportQuery,
  type UsageReport,
} from "@t3tools/contracts";
import { hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { agentUsageOwner } from "../families/agentUsage.ts";
import { agentUsage } from "../projections/agentUsage.ts";
import { hqNavigationLink } from "./hq.ts";
const query: UsageReportQuery = {
  since: "2026-10-01T00:00:00.000Z",
  until: "2026-10-08T00:00:00.000Z",
  mode: "utc-days",
  timezone: "UTC",
  projectId: null,
  appId: null,
  mateId: null,
  ownerUserId: null,
  provider: null,
  model: null,
  groupBy: "mate",
  provenance: "live-responses",
};
const owner = agentUsageOwner(query);
const scope: AgentUsageScope = { kind: "agentUsage", query };
const totals = {
  tokens: "100",
  records: "1",
  uncachedInput: "100",
  cachedInput: "0",
  cacheCreation: "0",
  output: "0",
  reasoning: "0",
  unknownComponents: "0",
};
const report: UsageReport = {
  query,
  provenance: "live-responses",
  generation: { accounting: "1", access: "0".repeat(64), pricing: "prices" },
  exactSince: null,
  recordedSince: "2026-10-01T00:00:00.000Z",
  basis: "recorded-provider-usage-current-owner-and-app",
  state: "partial",
  coverage: [],
  coverageMore: false,
  totals,
  pricing: {
    basis: "automatic-api-equivalent-estimate",
    revision: "prices",
    costUsdNanos: null,
    pricedModelEntries: "0",
    unpricedModelEntries: "2",
  },
  groups: [],
  groupsMore: false,
  detail: [
    {
      originId: "origin",
      factId: "fact",
      nativeId: "turn",
      provider: "claude",
      sessionId: "thread",
      parentId: null,
      evidence: "live-provider-turn",
      meterVersion: "native-turn-v1",
      time: { kind: "instant", at: "2026-10-01T12:00:00.000Z", provenance: "provider-completion" },
      nativeCost: { amount: "1000000", scale: 6, currency: "USD", basis: "turn" },
      models: [
        {
          model: null,
          components: {
            uncachedInput: "30",
            cachedInput: "0",
            cacheCreation: "0",
            output: "0",
            reasoning: "0",
            inclusiveTotal: "30",
          },
          nativeCost: null,
        },
        {
          model: "subagent-model",
          components: {
            uncachedInput: "70",
            cachedInput: "0",
            cacheCreation: "0",
            output: "0",
            reasoning: "0",
            inclusiveTotal: "70",
          },
          nativeCost: { amount: "500000", scale: 6, currency: "USD", basis: "model" },
        },
      ],
    },
  ],
  next: null,
};
it.effect("an HQ report for another query cannot replace the authorized usage answer", () =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    const fixture = hqFixtureWire();
    const link = hqNavigationLink({ orgId: "org", wire: fixture.wire, store });
    const release = link.demandDetail({ family: "agentUsage", ownerId: owner });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    yield* fixture.send({
      type: "scope-ready",
      scope: { kind: "navigation" },
      incarnation: "hq",
      revision: 1,
      core: { protocol: 1, agentUsage: AGENT_USAGE_REPORT_PROTOCOL },
    });
    yield* settle;
    yield* fixture.send({
      type: "scope-reset",
      scope,
      incarnation: "usage",
      revision: 1,
      values: [{ key: "report", value: report }],
      removals: [],
    });
    yield* fixture.send({ type: "scope-ready", scope, incarnation: "usage", revision: 1 });
    yield* settle;
    let revision = 1;
    for (const wrong of [
      { mateId: "other" },
      { groupBy: "model" },
      { provenance: "legacy-scanner" },
      { since: "2026-09-01T00:00:00.000Z" },
    ]) {
      yield* fixture.send({
        type: "scope-values",
        scope,
        incarnation: "usage",
        revision: ++revision,
        values: [
          {
            key: "report",
            value: {
              ...report,
              query: { ...query, ...wrong },
              totals: { ...totals, tokens: "999" },
            },
          },
        ],
        removals: [],
      });
      yield* settle;
      expect(agentUsage.derive(readsOfState(store.state()), { orgId: "org", owner })).toMatchObject(
        { kind: "read", report: { totals: { tokens: "100" } } },
      );
    }
    release();
    yield* Fiber.interrupt(fiber);
  }),
);
it.effect.each(
  Array.from([undefined, 1], (capability) => ({
    title: `HQ ${capability === undefined ? "without usage capability" : "report 1"} is not sent new usage scopes and names the required update`,
    capability,
  })),
)("$title", ({ capability }) =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    const fixture = hqFixtureWire();
    const link = hqNavigationLink({ orgId: "org", wire: fixture.wire, store });
    const release = link.demandDetail({ family: "agentUsage", ownerId: owner });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    const usageAsks = () =>
      fixture.sent.flatMap(({ request }) =>
        request.type === "subscribe"
          ? request.scopes.filter((entry) => entry.scope.kind === "agentUsage")
          : [],
      );
    expect(usageAsks()).toEqual([]);
    yield* fixture.send({
      type: "scope-ready",
      scope: { kind: "navigation" },
      incarnation: "hq",
      revision: 1,
      core: { protocol: 1, ...(capability === undefined ? {} : { agentUsage: capability }) },
    });
    yield* settle;
    link.retryDetail({ family: "agentUsage", ownerId: owner });
    yield* settle;
    expect(usageAsks()).toEqual([]);
    expect(agentUsage.derive(readsOfState(store.state()), { orgId: "org", owner })).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining("Update HQ"),
    });
    yield* fixture.send({
      type: "scope-ready",
      scope: { kind: "navigation" },
      incarnation: "hq",
      revision: 2,
      core: { protocol: 1, agentUsage: AGENT_USAGE_REPORT_PROTOCOL },
    });
    yield* settle;
    expect(usageAsks()).toHaveLength(1);
    yield* fixture.send({
      type: "scope-reset",
      scope,
      incarnation: "usage",
      revision: 1,
      values: [{ key: "report", value: report }],
      removals: [],
    });
    yield* fixture.send({ type: "scope-ready", scope, incarnation: "usage", revision: 1 });
    yield* settle;
    expect(agentUsage.derive(readsOfState(store.state()), { orgId: "org", owner })).toMatchObject({
      kind: "read",
      stale: false,
      report: {
        totals: { tokens: "100", records: "1" },
        pricing: { unpricedModelEntries: "2" },
        detail: report.detail,
      },
    });
    link.retryDetail({ family: "agentUsage", ownerId: owner });
    yield* settle;
    expect(usageAsks()).toHaveLength(2);
    yield* fixture.send({
      type: "scope-ready",
      scope: { kind: "navigation" },
      incarnation: "hq",
      revision: 3,
      core: { protocol: 1 },
    });
    yield* settle;
    expect(agentUsage.derive(readsOfState(store.state()), { orgId: "org", owner })).toMatchObject({
      kind: "read",
      stale: true,
      updateRequired: true,
      report: { totals: { tokens: "100" } },
    });
    yield* fixture.send({
      type: "scope-ready",
      scope: { kind: "navigation" },
      incarnation: "hq",
      revision: 4,
      core: { protocol: 1, agentUsage: AGENT_USAGE_REPORT_PROTOCOL },
    });
    yield* settle;
    yield* fixture.send({ type: "scope-ready", scope, incarnation: "usage", revision: 1 });
    yield* settle;
    yield* fixture.endSegment;
    yield* settle;
    expect(fixture.opens()).toBe(2);
    expect(
      fixture.sent
        .filter((sent) => sent.segment === 2)
        .flatMap(({ request }) =>
          request.type === "subscribe"
            ? request.scopes.filter((entry) => entry.scope.kind === "agentUsage")
            : [],
        ),
    ).toEqual([]);
    expect(agentUsage.derive(readsOfState(store.state()), { orgId: "org", owner })).toMatchObject({
      kind: "read",
      stale: true,
    });
    release();
    yield* Fiber.interrupt(fiber);
  }),
);
