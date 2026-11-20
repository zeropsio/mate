import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/reactivity";
import type { UsageReport, UsageReportQuery } from "@t3tools/contracts";
import { HQ_CORE, hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { agentUsageOwner } from "../families/agentUsage.ts";
import { agentUsage } from "../projections/agentUsage.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { hqNavigationLink } from "./hq.ts";

const query: UsageReportQuery = {
  since: null,
  until: "2026-01-02T00:00:00.000Z",
  mode: "exact",
  timezone: "UTC",
  projectId: null,
  appId: null,
  mateId: "v1",
  ownerUserId: null,
  provider: null,
  model: null,
  groupBy: "mate",
};
const statistics = (tokens: string) => ({
  tokens,
  uncachedInput: tokens,
  cachedInput: "0",
  cacheCreation: "0",
  output: "0",
  reasoning: "0",
  records: "1",
  unknownComponents: "0",
});
const reportOf = (asked: UsageReportQuery, tokens: string): UsageReport => ({
  query: asked,
  generation: { accounting: "1", access: "a".repeat(64), pricing: "v2" },
  exactSince: "2026-01-01T00:00:00.000Z",
  basis: "recorded-provider-usage-current-owner-and-app",
  state: "complete",
  coverage: [],
  coverageMore: false,
  totals: statistics(tokens),
  pricing: {
    basis: "automatic-api-equivalent-estimate",
    revision: "v2",
    costUsdNanos: null,
    pricedModelEntries: "0",
    unpricedModelEntries: "0",
  },
  groups: [],
  groupsMore: false,
  detail: [],
  next: null,
});

// witness: packages/client-runtime/src/data/families/agentUsage.ts | report !== null && agentUsageOwner(report.query) === owner?.ownerId ? report : null → report
it.effect(
  "AD61: HQ's usage report for another query never replaces the authorized usage answer",
  () =>
    Effect.gen(function* () {
      const owner = agentUsageOwner(query);
      const scope = { kind: "agentUsage" as const, query };
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const link = hqNavigationLink({ orgId: "v3", wire: fixture.wire, store });
      const release = link.demandDetail({ family: "agentUsage", ownerId: owner });
      const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
      const fiber = yield* Effect.forkChild(supervisor.run);
      yield* settle;
      yield* fixture.send({
        type: "scope-ready",
        scope: { kind: "navigation" },
        incarnation: "v4",
        revision: 1,
        core: HQ_CORE,
      });
      yield* fixture.send({
        type: "scope-reset",
        scope,
        incarnation: "v5",
        revision: 1,
        values: [{ key: "report", value: reportOf(query, "1") }],
        removals: [],
      });
      yield* fixture.send({
        type: "scope-ready",
        scope,
        incarnation: "v5",
        revision: 1,
        core: HQ_CORE,
      });
      yield* settle;
      const answer = () => agentUsage.derive(readsOfState(store.state()), { orgId: "v3", owner });
      expect(answer()).toMatchObject({ kind: "read", report: { query, totals: { tokens: "1" } } });

      yield* fixture.send({
        type: "scope-values",
        scope,
        incarnation: "v5",
        revision: 2,
        values: [{ key: "report", value: reportOf({ ...query, mateId: "v6" }, "2") }],
        removals: [],
      });
      yield* settle;
      expect(answer()).toMatchObject({ kind: "read", report: { query, totals: { tokens: "1" } } });

      release();
      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);
