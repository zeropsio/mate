import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";
import { usageOriginId, usageFactId } from "@t3tools/shared/agentUsage";
import { UsageReport, type UsageFact, type UsageReportQuery } from "@t3tools/contracts";
import { startCore, setUpMate, enrollMate, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const reportOf = Schema.decodeUnknownEffect(UsageReport);
// External rates have their own accounting tests; socket/access tests use a stable unavailable policy.
vi.mock("./usagePrices.ts", async (original) => ({
  ...(await original<typeof import("./usagePrices.ts")>()),
  makeUsagePriceReader: () => Effect.succeed(Effect.succeed(false)),
}));
const query: UsageReportQuery = {
  since: "2020-01-01T00:00:00.000Z",
  until: "2020-01-02T00:00:00.000Z",
  mode: "utc-days",
  timezone: "UTC",
  projectId: null,
  appId: null,
  mateId: null,
  ownerUserId: null,
  provider: null,
  model: null,
  groupBy: "month",
};
const fact: UsageFact = {
  originId: "origin",
  factId: usageFactId("native-thread", "request"),
  nativeId: "request",
  provider: "claude",
  models: [
    {
      model: "fixture-model",
      components: {
        uncachedInput: "100",
        cachedInput: "0",
        cacheCreation: "0",
        output: "0",
        reasoning: "0",
        inclusiveTotal: "100",
      },
      nativeCost: null,
    },
  ],
  nativeCost: null,
  time: { kind: "instant", at: "2020-01-01T12:00:00.000Z", provenance: "native" },
  evidence: "native",
  meterVersion: "fixture-1",
  sessionId: "native-thread",
  parentId: null,
};
const batch = (batchId: string, value: UsageFact) => ({
  type: "usage-facts",
  protocol: 2,
  batchId,
  origins: [],
  facts: [value],
});
describe("usage on the existing HQ sockets", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "negotiates, ACKs committed facts, demands one authorized report and preserves old state after a damaged usage frame",
      () =>
        Effect.gen(function* () {
          const core = yield* startCore(true, {
            reconcileEvery: Duration.infinity,
            streamRecheck: Duration.infinity,
            pingEvery: Duration.infinity,
            viewTtl: Duration.zero,
          });
          yield* untilHealth(core.call, "active");
          const session = yield* setUpMate(core.call, "P_MATE");
          const credential = yield* enrollMate(core.call, core.fake, "P_MATE");
          const { ticket } = (yield* core.call("POST", "/api/mate/link-ticket", {
            headers: { authorization: `Mate ${credential}` },
          })).body as { ticket: string };
          const link = yield* core.socket(`/api/mate/link?ticket=${ticket}`);
          const state = yield* link.next("state");
          const usage = state.usage as { mateId: string; capture: number; report: number };
          assert.strictEqual(usage.capture, 2);
          const originId = usageOriginId(
            { orgId: "ORG", projectId: "P_MATE", mateId: usage.mateId },
            "claude",
          );
          const completed = { ...fact, originId };
          yield* link.send({
            type: "usage-facts",
            protocol: 2,
            batchId: "register",
            facts: [],
            origins: [
              {
                originId,
                orgId: "ORG",
                projectId: "P_MATE",
                mateId: usage.mateId,
                provider: "claude",
                label: "Rig",
                coverage: {
                  state: "partial",
                  since: "2020-01-01T00:00:00.000Z",
                  through: "2020-01-02T00:00:00.000Z",
                  gaps: ["fixture"],
                },
              },
            ],
          });
          assert.strictEqual((yield* link.next("usage-ack")).batchId, "register");
          const sent = batch("first", completed);
          yield* link.send(sent);
          assert.deepStrictEqual((yield* link.next("usage-ack")).accepted, [
            { originId, factId: fact.factId },
          ]);
          const { ticket: viewerTicket } = (yield* core.call("POST", "/api/stream-ticket", {
            session,
          })).body as { ticket: string };
          const viewer = yield* core.socket(`/api/structure/ws?ticket=${viewerTicket}`);
          yield* viewer.send({
            type: "subscribe",
            scopes: [{ scope: { kind: "navigation" } }, { scope: { kind: "agentUsage", query } }],
          });
          let found = false;
          let capability = false;
          for (let ready = 0; ready < 2;) {
            const message = yield* viewer.takeWhere(
              "report delivery",
              (message) =>
                message.type === "scope-ready" ||
                message.type === "scope-reset" ||
                message.type === "scope-values",
            );
            if (message.type === "scope-ready") {
              ready++;
              capability =
                capability || (message.core as { agentUsage?: number })?.agentUsage === 2;
            }
            if (message.type === "scope-reset" || message.type === "scope-values") {
              const scope = message.scope as { kind: string };
              if (scope.kind === "agentUsage") {
                const rows = message.values as { value: unknown }[];
                const report = yield* reportOf(rows[0]!.value);
                assert.strictEqual(report.totals.tokens, "100");
                found = true;
              }
            }
          }
          assert.isTrue(found);
          assert.isTrue(capability);
          yield* link.send({
            type: "usage-facts",
            protocol: 2,
            batchId: "damaged",
            origins: [],
            facts: [{}],
          });
          assert.strictEqual((yield* link.next("usage-error")).code, "usage_frame_invalid");
          yield* core.call("POST", "/api/mates/P_MATE/closed-off", { session });
          const after = yield* link.next("state");
          assert.isTrue((after.mate as { closedOff: boolean }).closedOff);
          const corrected = {
            ...completed,
            factId: usageFactId("native-thread", "request-2"),
            nativeId: "request-2",
            models: [
              {
                ...fact.models[0]!,
                components: {
                  ...fact.models[0]!.components,
                  uncachedInput: "150",
                  inclusiveTotal: "150",
                },
              },
            ],
          };
          yield* link.send(batch("second", corrected));
          assert.strictEqual((yield* link.next("usage-ack")).batchId, "second");
          let total = "100";
          let retainedCursor: { incarnation: string; revision: number } | undefined;
          while (total !== "250") {
            const message = yield* viewer.takeWhere(
              "report delivery",
              (message) =>
                message.type === "scope-ready" ||
                message.type === "scope-reset" ||
                message.type === "scope-values",
            );
            if (
              (message.type === "scope-values" || message.type === "scope-reset") &&
              (message.scope as { kind: string }).kind === "agentUsage"
            ) {
              const report = yield* reportOf((message.values as { value: unknown }[])[0]!.value);
              total = report.totals.tokens;
              retainedCursor = {
                incarnation: String(message.incarnation),
                revision: Number(message.revision),
              };
            }
          }
          const firstDetail = {
            kind: "agentUsage" as const,
            query,
            detail: { tier: "daily" as const },
          };
          yield* viewer.send({ type: "subscribe", scopes: [{ scope: firstDetail }] });
          const firstPage = yield* viewer.takeWhere(
            "daily first page",
            (message) =>
              (message.type === "scope-reset" || message.type === "scope-values") &&
              (message.scope as { detail?: { tier: string; cursor?: unknown } }).detail?.tier ===
                "daily",
          );
          const firstPageReport = yield* reportOf(
            (firstPage.values as { value: unknown }[])[0]!.value,
          );
          const pageScope = {
            ...firstDetail,
            detail: {
              tier: "daily" as const,
              cursor: {
                generation: firstPageReport.generation,
                after: json([
                  "2020-01-01",
                  originId,
                  "fixture-model",
                  "api-equivalent-baseline",
                  "fixture-1",
                  "1111",
                ]),
              },
            },
          };
          yield* viewer.send({ type: "unsubscribe", scopes: [firstDetail] });
          yield* viewer.send({ type: "subscribe", scopes: [{ scope: pageScope }] });
          const pageValue = yield* viewer.takeWhere(
            "daily retained page",
            (message) =>
              (message.type === "scope-reset" || message.type === "scope-values") &&
              (message.scope as { detail?: { cursor?: unknown } }).detail?.cursor !== undefined,
          );
          assert.strictEqual(
            (yield* reportOf((pageValue.values as { value: unknown }[])[0]!.value)).totals.tokens,
            "250",
          );
          const pageCursor = {
            incarnation: String(pageValue.incarnation),
            revision: Number(pageValue.revision),
          };
          core.fake.members.set(
            "ORG",
            core.fake.members
              .get("ORG")!
              .map((person) =>
                person.userId === "owner" ? { ...person, roleCode: "NO_ACCESS" } : person,
              ),
          );
          const projectIndex = core.fake.projects.findIndex((project) => project.id === "P_MATE");
          core.fake.projects[projectIndex] = {
            ...core.fake.projects[projectIndex]!,
            userRoles: [{ clientUserId: "C-owner", roleCode: "NO_ACCESS" }],
          };
          yield* core.call("GET", "/api/structure", { session });
          let summaryPurged = false,
            pagePurged = false;
          while (!summaryPurged || !pagePurged) {
            const revoked = yield* viewer.takeWhere(
              "usage access reset",
              (message) =>
                message.type === "scope-reset" &&
                (message.scope as { kind: string }).kind === "agentUsage",
            );
            if ((revoked.scope as { detail?: unknown }).detail === undefined) {
              assert.strictEqual(
                (yield* reportOf((revoked.values as { value: unknown }[])[0]!.value)).totals.tokens,
                "0",
              );
              assert.notStrictEqual(revoked.incarnation, retainedCursor!.incarnation);
              summaryPurged = true;
            } else {
              assert.lengthOf(revoked.values as unknown[], 0);
              assert.notStrictEqual(revoked.incarnation, pageCursor.incarnation);
              pagePurged = true;
            }
          }
          yield* viewer.send({ type: "unsubscribe", scopes: [{ kind: "agentUsage", query }] });
          yield* viewer.send({
            type: "subscribe",
            scopes: [
              {
                scope: { kind: "agentUsage", query },
                cursor: retainedCursor!,
                knownKeys: ["report"],
              },
            ],
          });
          const replay = yield* viewer.takeWhere(
            "authorized usage replay",
            (message) =>
              (message.type === "scope-values" || message.type === "scope-reset") &&
              (message.scope as { kind: string }).kind === "agentUsage",
          );
          assert.strictEqual(
            (yield* reportOf((replay.values as { value: unknown }[])[0]!.value)).totals.tokens,
            "0",
          );
          yield* viewer.send({ type: "unsubscribe", scopes: [pageScope] });
          yield* viewer.send({
            type: "subscribe",
            scopes: [{ scope: pageScope, cursor: pageCursor, knownKeys: ["report"] }],
          });
          const deniedPage = yield* viewer.takeWhere(
            "invalidated page replay",
            (message) =>
              message.type === "scope-reset" &&
              (message.scope as { detail?: { cursor?: unknown } }).detail?.cursor !== undefined,
          );
          assert.lengthOf(deniedPage.values as unknown[], 0);
        }),
    );
  });
});
