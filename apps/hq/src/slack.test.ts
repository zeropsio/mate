// @effect-diagnostics nodeBuiltinImport:off -- Slack signs its events with HMAC-SHA256; the tests post them over HTTP.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { assert, describe, it } from "@effect/vitest";
import type { MateTaskMessage } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpRouter from "effect/http/HttpRouter";
import * as SqlClient from "effect/sql/SqlClient";
import * as HttpServer from "effect/http/HttpServer";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TEST_KEY_SECRET } from "../test/harness/deployKeys.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import { SLACK_BOT_TOKEN, slackFake } from "../test/harness/slackFake.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { deployKeysLayer, keySecretOf } from "./deployKeys.ts";
import { doorRateLimitLayer } from "./rateLimit.ts";
import { rolesLayer } from "./roles.ts";
import { Slack, slackLayer } from "./slack.ts";
import { slackApiLayer } from "./slackApi.ts";
import { slackEventsRoute } from "./slackRoutes.ts";
import { REPLIES } from "./slackText.ts";
import {
  type TaskEnqueue,
  TaskIntake,
  type TaskEnd,
  type TaskSourceChannel,
  TaskSourceChannels,
} from "./taskSources.ts";
import { ZeropsApi, type ZeropsMember } from "./zerops/api.ts";

/** A fake signing secret, built from parts so no scanner takes it for one. */
const SIGNING_SECRET = ["fake", "signing", "secret", "0123456789abcdef"].join("-");

const member = (userId: string, roleCode: string, email: string): ZeropsMember => ({
  name: userId,
  kind: "person",
  roleCode,
  status: "ACTIVE",
  userId,
  clientUserId: `C-${userId}`,
  canCreateProjects: false,
  email,
});

/** The organization Acme: its owner Nova and its developer Rhea, and HQ's project. */
const acme = () => {
  const world = emptyWorld();
  world.tokens.set("t", {
    id: "T",
    name: "mate-hq-org:HQ",
    orgId: "ORG",
    roleCode: "READ_ONLY",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: [],
    createdMs: 0,
    createdByUser: "owner",
  });
  world.members.set("ORG", [
    member("owner", "OWNER", "nova@acme.test"),
    member("dev", "DEVELOPER", "Rhea@Acme.test"),
  ]);
  world.projects.push({
    id: "HQ",
    orgId: "ORG",
    name: "HQ",
    status: "ACTIVE",
    tags: [],
    userRoles: [],
    publicZone: "hq.prg1-zerops.zone",
  });
  return world;
};

/** HQ's door for sources, as the tests see it: what was asked of it, and which keys live. */
const fakeIntake = Effect.gen(function* () {
  const enqueued = yield* Queue.unbounded<TaskEnqueue>();
  const messages = yield* Queue.unbounded<{
    readonly sourceKey: string;
    readonly message: MateTaskMessage;
  }>();
  const stops = yield* Queue.unbounded<{ readonly sourceKey: string; readonly reason: string }>();
  const live = new Set<string>();
  /** The keys whose task ended, and how, until a reply after it was answered. */
  const ended = new Map<string, TaskEnd>();
  /** While set, HQ takes no task in (not the leading HQ, its database away). */
  const away = { now: false };
  const service = TaskIntake.of({
    enqueue: (input) =>
      Effect.gen(function* () {
        if (away.now) return yield* Effect.die("HQ is away");
        yield* Queue.offer(enqueued, input);
        if (live.has(input.sourceKey)) return { kind: "told", taskId: "task-1" } as const;
        live.add(input.sourceKey);
        return { kind: "queued", taskId: `task-${String(live.size)}`, position: 1 } as const;
      }),
    message: (sourceKey, message) =>
      Effect.as(Queue.offer(messages, { sourceKey, message }), live.has(sourceKey)),
    stop: (sourceKey, reason) =>
      Effect.sync(() => live.delete(sourceKey)).pipe(
        Effect.andThen(Queue.offer(stops, { sourceKey, reason })),
      ),
    answerEnded: (sourceKey, allowed) =>
      Effect.gen(function* () {
        const end = ended.get(sourceKey);
        if (end === undefined || !(yield* allowed)) return undefined;
        ended.delete(sourceKey);
        return end;
      }),
  });
  return { service, enqueued, messages, stops, live, ended, away };
});

/**
 * HQ's Slack over a leading Core's database and Acme's org, Slack's Web API faked, its events route
 * served; every log line kept.
 */
const withSlack = Effect.gen(function* () {
  const slack = yield* slackFake;
  const url = yield* (yield* TempPostgres).createMigratedDatabase;
  const intake = yield* fakeIntake;
  const world = acme();
  const registered: Array<TaskSourceChannel> = [];
  const logged: Array<string> = [];
  const services = slackLayer({ hqProjectId: "HQ" }).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        slackApiLayer(slack.url).pipe(Layer.provide(NodeHttpClient.layerNodeHttp)),
        Layer.succeed(TaskIntake, intake.service),
        Layer.succeed(TaskSourceChannels, {
          register: (channel) => Effect.sync(() => void registered.push(channel)),
          of: (kind) => Effect.sync(() => registered.find((channel) => channel.kind === kind)),
        }),
        deployKeysLayer(keySecretOf(Option.some(Redacted.make(TEST_KEY_SECRET)))),
        rolesLayer({ hqProjectId: "HQ", credential: Option.some(Redacted.make("t")) }).pipe(
          Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(world))),
        ),
        doorRateLimitLayer,
      ),
    ),
    Layer.provideMerge(activeCoreLayer(url)),
  );
  const context = yield* Layer.build(
    HttpRouter.serve(slackEventsRoute).pipe(
      Layer.provideMerge(
        NodeHttpServer.layer(() => NodeHttp.createServer(), { host: "127.0.0.1", port: 0 }),
      ),
      Layer.provideMerge(services),
      Layer.provide(
        Logger.layer([
          Logger.make(({ message, cause }) => {
            logged.push(JSON.stringify({ message, cause: String(cause) }));
          }),
        ]),
      ),
    ),
  );
  yield* untilActive.pipe(Effect.provide(context));
  const service = Context.get(context, Slack);
  const address = Context.get(context, HttpServer.HttpServer).address;
  const port = "port" in address ? address.port : 0;
  const sql = Context.get(context, SqlClient.SqlClient);
  const client = yield* HttpClient.HttpClient;
  /** An application of Acme's, made as its owner. */
  const appNamed = (name: string) =>
    Effect.map(
      sql<{ readonly id: string }>`
        INSERT INTO hq_app (name, created_by) VALUES (${name}, 'owner') RETURNING id::text AS id`,
      ([row]) => row?.id ?? "",
    );
  const appId = yield* appNamed("Tea Shop");
  const publicId = Effect.map(service.view, (view) => view.eventsUrl.split("/").at(-1) ?? "");

  /** Slack's post of `body` to the events address, signed as Slack signs, unless told otherwise. */
  const post = (
    body: unknown,
    options: {
      readonly secret?: string;
      readonly ageSeconds?: number;
      readonly signature?: string | null;
      readonly publicId?: string;
    } = {},
  ) =>
    Effect.gen(function* () {
      const text = JSON.stringify(body);
      const now = yield* Clock.currentTimeMillis;
      const timestamp = String(Math.floor(now / 1000) - (options.ageSeconds ?? 0));
      const signature =
        options.signature === undefined
          ? `v0=${NodeCrypto.createHmac("sha256", options.secret ?? SIGNING_SECRET)
              .update(`v0:${timestamp}:${text}`)
              .digest("hex")}`
          : options.signature;
      const to = options.publicId ?? (yield* publicId);
      const response = yield* client.execute(
        HttpClientRequest.post(`http://127.0.0.1:${String(port)}/api/intake/slack/${to}`).pipe(
          HttpClientRequest.setHeader("x-slack-request-timestamp", timestamp),
          signature === null
            ? (request) => request
            : HttpClientRequest.setHeader("x-slack-signature", signature),
          HttpClientRequest.bodyText(text, "application/json"),
        ),
      );
      return { status: response.status, body: yield* response.json };
    });

  /** An event of Acme's workspace, as Slack wraps it. */
  let events = 0;
  const event = (inner: Record<string, unknown>) => {
    events += 1;
    return {
      type: "event_callback",
      team_id: "T0TEA",
      event_id: `Ev${String(events)}`,
      event: inner,
    };
  };

  /** Connected as Acme's owner, `#support` (`C0SUPPORT`) taking the application's tasks. */
  const connected = Effect.gen(function* () {
    slack.state.channels.set("C0SUPPORT", { name: "support", member: true });
    slack.state.users.set("U0NOVA", { email: "NOVA@acme.test", name: "Nova" });
    yield* service.connect("owner", {
      botToken: Redacted.make(SLACK_BOT_TOKEN),
      signingSecret: Redacted.make(SIGNING_SECRET),
    });
    yield* service.mapChannel("owner", appId, "C0SUPPORT");
  });

  return {
    slack,
    world,
    url,
    intake,
    registered,
    logged,
    service,
    appId,
    appNamed,
    post,
    event,
    connected,
    publicId,
  };
});

const mention = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "app_mention",
  user: "U0NOVA",
  text,
  ts: "1700000000.000100",
  channel: "C0SUPPORT",
  ...extra,
});

describe("Slack", () => {
  it.layer(Layer.merge(tempPostgresLayer, NodeHttpClient.layerNodeHttp), {
    excludeTestServices: true,
  })((it) => {
    it.effect(
      "the organization's owner connects Slack with its bot token and signing secret, sealed; HQ names the workspace and never answers either back",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          const before = yield* hq.service.view;
          assert.deepStrictEqual(before.connected, false);
          assert.match(
            before.eventsUrl,
            /^https:\/\/hq\.prg1-zerops\.zone\/api\/intake\/slack\/[\w-]{20,}$/u,
          );
          const view = yield* hq.service.connect("owner", {
            botToken: Redacted.make(SLACK_BOT_TOKEN),
            signingSecret: Redacted.make(SIGNING_SECRET),
          });
          assert.deepStrictEqual(view, {
            connected: true,
            workspace: "Tea Shop",
            eventsUrl: before.eventsUrl,
            eventsRefusedAt: null,
            eventsAcceptedAt: null,
          });
          const [identity] = yield* hq.slack.callsOf("auth.test");
          assert.strictEqual(identity?.authorization, `Bearer ${SLACK_BOT_TOKEN}`);
          const [row] = yield* rowsWhere(
            hq.url,
            "SELECT encode(token_sealed, 'escape') AS token, encode(secret_sealed, 'escape') AS secret, team_id FROM hq_slack",
            (rows) => rows.length === 1,
          );
          assert.strictEqual(row!["team_id"], "T0TEA");
          assert.notInclude(String(row!["token"]), SLACK_BOT_TOKEN);
          assert.notInclude(String(row!["secret"]), SIGNING_SECRET);
          for (const answer of [view, yield* hq.service.view]) {
            assert.notInclude(JSON.stringify(answer), SLACK_BOT_TOKEN);
            assert.notInclude(JSON.stringify(answer), SIGNING_SECRET);
          }
          yield* hq.service.disconnect("owner");
          assert.deepStrictEqual(yield* hq.service.view, {
            connected: false,
            workspace: null,
            eventsUrl: before.eventsUrl,
            eventsRefusedAt: null,
            eventsAcceptedAt: null,
          });
          for (const line of hq.logged) {
            assert.notInclude(line, SLACK_BOT_TOKEN);
            assert.notInclude(line, SIGNING_SECRET);
          }
        }),
    );

    it.effect("a bot token Slack refuses connects nothing", () =>
      Effect.gen(function* () {
        const hq = yield* withSlack;
        const refused = yield* Effect.flip(
          hq.service.connect("owner", {
            botToken: Redacted.make(["xoxb", "9", "9", "notthetoken"].join("-")),
            signingSecret: Redacted.make(SIGNING_SECRET),
          }),
        );
        assert.deepInclude(refused, { code: "invalid", reason: "bot_token_refused" });
        const malformed = yield* Effect.flip(
          hq.service.connect("owner", {
            botToken: Redacted.make("not a bot token"),
            signingSecret: Redacted.make(SIGNING_SECRET),
          }),
        );
        assert.deepInclude(malformed, { code: "invalid", reason: "bot_token" });
        assert.strictEqual((yield* hq.service.view).connected, false);
      }),
    );

    it.effect(
      "only an owner or admin of the organization connects Slack or reads its manifest",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          const secrets = {
            botToken: Redacted.make(SLACK_BOT_TOKEN),
            signingSecret: Redacted.make(SIGNING_SECRET),
          };
          for (const refused of [
            yield* Effect.flip(hq.service.connect("dev", secrets)),
            yield* Effect.flip(hq.service.disconnect("dev")),
            yield* Effect.flip(hq.service.manifest("dev")),
          ])
            assert.deepInclude(refused, { code: "forbidden" });
          assert.lengthOf(yield* hq.slack.callsOf("auth.test"), 0);
        }),
    );

    it.effect(
      "the manifest makes a Slack app named Mate with the bot's scopes and events, sending them to HQ's own address",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          const manifest = yield* hq.service.manifest("owner");
          assert.strictEqual(manifest.display_information.name, "Mate");
          assert.strictEqual(manifest.features.bot_user.display_name, "Mate");
          assert.sameMembers(manifest.oauth_config.scopes.bot, [
            "app_mentions:read",
            "chat:write",
            "channels:history",
            "groups:history",
            "reactions:write",
            "users:read",
            "users:read.email",
            "channels:read",
            "groups:read",
          ]);
          assert.deepStrictEqual(manifest.settings.event_subscriptions, {
            request_url: (yield* hq.service.view).eventsUrl,
            bot_events: ["app_mention", "message.channels", "message.groups"],
          });
        }),
    );

    it.effect(
      "an application takes tasks from one channel Slack says exists and the bot is in, never one another application takes them from",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          assert.deepStrictEqual(yield* hq.service.channelOf(hq.appId), {
            appId: hq.appId,
            channelId: "C0SUPPORT",
            channel: "support",
          });
          hq.slack.state.channels.set("C0QUIET", { name: "quiet", member: false });
          const refusals = [
            yield* Effect.flip(hq.service.mapChannel("owner", hq.appId, "C0NOWHERE")),
            yield* Effect.flip(hq.service.mapChannel("owner", hq.appId, "C0QUIET")),
            yield* Effect.flip(hq.service.mapChannel("dev", hq.appId, "C0SUPPORT")),
          ];
          assert.deepStrictEqual(
            refusals.map((refused) =>
              refused._tag === "AutomationRefused"
                ? [refused.code, refused.reason]
                : [refused._tag],
            ),
            [
              ["invalid", "channel_not_found"],
              ["conflict", "not_in_channel"],
              ["forbidden", "not_structure_writer"],
            ],
          );
          const other = yield* hq.appNamed("Shop Front");
          const taken = yield* Effect.flip(hq.service.mapChannel("owner", other, "C0SUPPORT"));
          assert.deepInclude(taken, { code: "conflict", reason: "channel_taken" });
          yield* hq.service.unmapChannel("owner", hq.appId);
          assert.isUndefined(yield* hq.service.channelOf(hq.appId));
        }),
    );

    it.effect(
      "connecting Slack again keeps every application's channel, a new app's included, as Slack names it now; an archived one goes, and connected to another workspace they all go",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          const front = yield* hq.appNamed("Shop Front");
          hq.slack.state.channels.set("C0FRONT", { name: "front", member: true });
          yield* hq.service.mapChannel("owner", front, "C0FRONT");
          yield* hq.service.disconnect("owner");
          assert.strictEqual((yield* hq.service.channelOf(hq.appId))?.channel, "support");
          // A new Slack app in the same workspace: its own bot and token.
          const newToken = ["xoxb", "1000", "3000", "newfakenewfake"].join("-");
          hq.slack.state.token = newToken;
          hq.slack.state.botUserId = "U0MATE2";
          hq.slack.state.channels.set("C0SUPPORT", { name: "support-desk", member: false });
          hq.slack.state.channels.set("C0FRONT", { name: "front", member: true, archived: true });
          yield* hq.service.connect("owner", {
            botToken: Redacted.make(newToken),
            signingSecret: Redacted.make(SIGNING_SECRET),
          });
          assert.deepStrictEqual(yield* hq.service.channelOf(hq.appId), {
            appId: hq.appId,
            channelId: "C0SUPPORT",
            channel: "support-desk",
          });
          assert.isUndefined(yield* hq.service.channelOf(front));
          hq.slack.state.team = { id: "T0ELSE", name: "Elsewhere" };
          yield* hq.service.connect("owner", {
            botToken: Redacted.make(newToken),
            signingSecret: Redacted.make(SIGNING_SECRET),
          });
          assert.isUndefined(yield* hq.service.channelOf(hq.appId));
        }),
    );

    it.effect(
      "an owner replaces the signing secret or the bot token of a connected Slack in place: its channels stay, and events signed with the old secret are refused",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          const alone = yield* Effect.flip(
            hq.service.connect("owner", { signingSecret: Redacted.make(SIGNING_SECRET) }),
          );
          assert.deepInclude(alone, { code: "invalid", reason: "bot_token" });
          yield* hq.connected;
          const checks = (yield* hq.slack.callsOf("auth.test")).length;
          const newSecret = ["fake", "signing", "secret", "fedcba9876543210"].join("-");
          const view = yield* hq.service.connect("owner", {
            signingSecret: Redacted.make(newSecret),
          });
          assert.deepInclude(view, { connected: true, workspace: "Tea Shop" });
          assert.lengthOf(yield* hq.slack.callsOf("auth.test"), checks);
          const ask = hq.event(mention("<@U0MATE> brew more tea"));
          assert.strictEqual((yield* hq.post(ask)).status, 401);
          assert.strictEqual((yield* hq.post(ask, { secret: newSecret })).status, 200);
          const newToken = ["xoxb", "1000", "4000", "rotatedfakefake"].join("-");
          hq.slack.state.token = newToken;
          yield* hq.service.connect("owner", { botToken: Redacted.make(newToken) });
          const [, checked] = yield* hq.slack.callsOf("auth.test");
          assert.strictEqual(checked?.authorization, `Bearer ${newToken}`);
          assert.strictEqual(
            (yield* hq.post(hq.event(mention("<@U0MATE> and scones")), { secret: newSecret }))
              .status,
            200,
          );
          assert.strictEqual((yield* hq.service.channelOf(hq.appId))?.channelId, "C0SUPPORT");
          const refused = yield* Effect.flip(
            hq.service.connect("dev", { signingSecret: Redacted.make(newSecret) }),
          );
          assert.deepInclude(refused, { code: "forbidden" });
        }),
    );

    it.effect(
      "HQ keeps when an event's signature last failed and last held; replacing the signing secret forgets the failures",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          const ask = hq.event(mention("<@U0MATE> brew more tea"));
          // No signature at all, or a stale one, says nothing of the secret.
          yield* hq.post(ask, { signature: null });
          yield* hq.post(ask, { ageSeconds: 6 * 60 });
          assert.deepInclude(yield* hq.service.view, {
            eventsRefusedAt: null,
            eventsAcceptedAt: null,
          });
          yield* hq.post(ask, { secret: "not-the-secret" });
          const refused = yield* hq.service.view;
          assert.isString(refused.eventsRefusedAt);
          assert.isNull(refused.eventsAcceptedAt);
          yield* hq.post(ask);
          const held = yield* hq.service.view;
          assert.isTrue(held.eventsAcceptedAt! >= held.eventsRefusedAt!);
          yield* hq.post(ask, { secret: "not-the-secret" });
          const again = yield* hq.service.view;
          assert.isTrue(again.eventsRefusedAt! >= again.eventsAcceptedAt!);
          yield* hq.service.connect("owner", {
            signingSecret: Redacted.make(["fake", "signing", "secret", "replaced00"].join("-")),
          });
          assert.isNull((yield* hq.service.view).eventsRefusedAt);
        }),
    );

    it.effect(
      "a structure writer lists the channels the bot is in, unarchived, by name, every page of them, with the bot's name to invite",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          const unconnected = yield* Effect.flip(hq.service.channels("owner"));
          assert.deepInclude(unconnected, { code: "conflict", reason: "slack_not_connected" });
          yield* hq.connected;
          hq.slack.state.channels.set("C0ZED", { name: "zed", member: true });
          hq.slack.state.channels.set("C0QUIET", { name: "quiet", member: false });
          hq.slack.state.channels.set("C0OLD", { name: "old", member: true, archived: true });
          hq.slack.state.channels.set("C0ALPHA", { name: "alpha", member: true });
          assert.deepStrictEqual(yield* hq.service.channels("owner"), {
            bot: "mate",
            channels: [
              { id: "C0ALPHA", name: "alpha" },
              { id: "C0SUPPORT", name: "support" },
              { id: "C0ZED", name: "zed" },
            ],
          });
          assert.lengthOf(yield* hq.slack.callsOf("users.conversations"), 2);
          const refused = yield* Effect.flip(hq.service.channels("dev"));
          assert.deepInclude(refused, { code: "forbidden" });
        }),
    );

    it.effect(
      "an event whose signature does not hold, or older than five minutes, is refused and takes nothing in",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          const ask = hq.event(mention("<@U0MATE> brew more tea"));
          const answers = [
            yield* hq.post(ask, { signature: null }),
            yield* hq.post(ask, { signature: `v0=${"ab".repeat(32)}` }),
            yield* hq.post(ask, { secret: "not-the-secret" }),
            yield* hq.post(ask, { ageSeconds: 6 * 60 }),
          ];
          assert.deepStrictEqual(
            answers.map((answer) => [answer.status, answer.body]),
            Array.from({ length: 4 }, () => [401, { code: "unauthorized" }]),
          );
          const elsewhere = yield* hq.post(ask, { publicId: "no-such-connection" });
          assert.strictEqual(elsewhere.status, 404);
          yield* hq.service.drained;
          assert.strictEqual(yield* Queue.size(hq.intake.enqueued), 0);
          const signed = yield* hq.post(ask);
          assert.strictEqual(signed.status, 200);
          yield* Queue.take(hq.intake.enqueued);
        }),
    );

    it.effect(
      "Slack's check of the events address is answered, before the app is connected and after",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          const check = { type: "url_verification", token: "legacy", challenge: "tea-challenge" };
          const unconnected = yield* hq.post(check, { signature: null });
          assert.deepStrictEqual(
            [unconnected.status, unconnected.body],
            [200, { challenge: "tea-challenge" }],
          );
          const nothingElse = yield* hq.post(hq.event(mention("<@U0MATE> hi")), {
            signature: null,
          });
          assert.strictEqual(nothingElse.status, 404);
          yield* hq.connected;
          const signed = yield* hq.post(check);
          assert.deepStrictEqual(
            [signed.status, signed.body],
            [200, { challenge: "tea-challenge" }],
          );
          const unsigned = yield* hq.post(check, { signature: null });
          assert.strictEqual(unsigned.status, 401);
        }),
    );

    it.effect(
      "@Mate in a mapped channel, by a member of the workspace, asks for a task keyed by its thread, in plain words, for the Zerops member of their email, and the ask is marked as heard",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          const answer = yield* hq.post(
            hq.event(
              mention(
                "<@U0MATE> The menu page is slow &amp; ugly\nSee <https://acme.test/menu|the menu> in <#C0SUPPORT|support>",
              ),
            ),
          );
          assert.deepStrictEqual([answer.status, answer.body], [200, {}]);
          const asked = yield* Queue.take(hq.intake.enqueued);
          assert.deepStrictEqual(asked, {
            appId: hq.appId,
            source: {
              kind: "slack-thread",
              workspace: "Tea Shop",
              channel: "support",
              url: "https://teashop.slack.com/archives/C0SUPPORT/p1700000000000100",
              title: "The menu page is slow & ugly",
              author: "Nova",
            },
            body: "The menu page is slow & ugly\nSee the menu (https://acme.test/menu) in #support",
            sourceKey: "slack:T0TEA/C0SUPPORT/1700000000.000100",
            deliveryId: "slack:T0TEA/Ev1",
            requestedBy: "owner",
          });
          const [channel] = hq.registered;
          assert.strictEqual(channel?.kind, "slack-thread");
          yield* channel!.acknowledge({
            taskId: "task-1",
            appId: hq.appId,
            source: asked.source,
            sourceKey: asked.sourceKey,
          });
          const reactions = yield* hq.slack.callsOf("reactions.add");
          assert.deepStrictEqual(
            reactions.map((call) => call.params),
            [{ channel: "C0SUPPORT", timestamp: "1700000000.000100", name: "eyes" }],
          );
        }),
    );

    it.effect(
      "someone of another workspace, deactivated or a stranger to this one is told only the workspace's members can ask Mate, and nothing is asked, whatever their email",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          const outsiders = {
            U0PARTNER: { teamId: "T0PARTNER" },
            U0DELETED: { deleted: true },
            U0STRANGER: { stranger: true },
          };
          for (const [user, odd] of Object.entries(outsiders)) {
            hq.slack.state.users.set(user, { email: "nova@acme.test", name: "Nova?", ...odd });
            yield* hq.post(hq.event(mention("<@U0MATE> deploy everything", { user })));
          }
          yield* hq.service.drained;
          assert.strictEqual(yield* Queue.size(hq.intake.enqueued), 0);
          assert.deepStrictEqual(
            (yield* hq.slack.callsOf("chat.postMessage")).map((call) => [
              call.params["thread_ts"],
              call.params["text"],
            ]),
            Array.from({ length: 3 }, () => ["1700000000.000100", REPLIES.notMember]),
          );
        }),
    );

    it.effect("an ask HQ cannot take in now is answered so, for the person to ask again", () =>
      Effect.gen(function* () {
        const hq = yield* withSlack;
        yield* hq.connected;
        hq.intake.away.now = true;
        yield* hq.post(hq.event(mention("<@U0MATE> brew more tea")));
        yield* hq.service.drained;
        const [reply] = yield* hq.slack.callsOf("chat.postMessage");
        assert.deepStrictEqual(
          [reply?.params["thread_ts"], reply?.params["text"]],
          ["1700000000.000100", REPLIES.unavailable],
        );
      }),
    );

    it.effect("a guest of the workspace may not ask, nor steer a task", () =>
      Effect.gen(function* () {
        const hq = yield* withSlack;
        yield* hq.connected;
        hq.slack.state.users.set("U0GUEST", { email: "nova@acme.test", name: "Gus", guest: true });
        hq.slack.state.users.set("U0SINGLE", {
          email: "nova@acme.test",
          name: "Sid",
          guest: "single-channel",
        });
        for (const user of ["U0GUEST", "U0SINGLE"])
          yield* hq.post(hq.event(mention("<@U0MATE> deploy everything", { user })));
        yield* hq.service.drained;
        assert.strictEqual(yield* Queue.size(hq.intake.enqueued), 0);
        assert.deepStrictEqual(
          (yield* hq.slack.callsOf("chat.postMessage")).map((call) => call.params["text"]),
          [REPLIES.notMember, REPLIES.notMember],
        );
        yield* hq.post(hq.event(mention("<@U0MATE> brew more tea", { ts: "1700000000.000300" })));
        yield* Queue.take(hq.intake.enqueued);
        yield* hq.post(
          hq.event({
            type: "message",
            channel: "C0SUPPORT",
            user: "U0GUEST",
            text: "Make it coffee",
            ts: "1700000000.000400",
            thread_ts: "1700000000.000300",
          }),
        );
        yield* hq.service.drained;
        assert.strictEqual(yield* Queue.size(hq.intake.messages), 0);
      }),
    );

    it.effect(
      "a workspace member whose email no Zerops member has asks, and the task names no asker",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          const unnamed = {
            U0PAT: { email: "pat@elsewhere.test" },
            U0KIM: { email: null },
            // Nova's address, but Slack never confirmed it is this user's.
            U0UNCONFIRMED: { email: "nova@acme.test", emailConfirmed: false },
          };
          let ts = 500;
          for (const [user, odd] of Object.entries(unnamed)) {
            ts += 1;
            hq.slack.state.users.set(user, { name: user, ...odd });
            yield* hq.post(
              hq.event(
                mention("<@U0MATE> brew more tea", { user, ts: `1700000000.000${String(ts)}` }),
              ),
            );
          }
          const asked = [
            yield* Queue.take(hq.intake.enqueued),
            yield* Queue.take(hq.intake.enqueued),
            yield* Queue.take(hq.intake.enqueued),
          ];
          // Each event is worked after Slack's answer, so the three asks arrive in any order.
          assert.sameDeepMembers(
            asked.map((ask) => [
              ask.source.kind === "slack-thread" ? ask.source.author : null,
              ask.requestedBy,
            ]),
            [
              ["U0PAT", null],
              ["U0KIM", null],
              ["U0UNCONFIRMED", null],
            ],
          );
        }),
    );

    it.effect(
      "a mention in a channel no application takes tasks from is answered so and asks for nothing",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          yield* hq.post(hq.event(mention("<@U0MATE> help", { channel: "C0RANDOM" })));
          yield* hq.service.drained;
          assert.strictEqual(yield* Queue.size(hq.intake.enqueued), 0);
          const [reply] = yield* hq.slack.callsOf("chat.postMessage");
          assert.deepStrictEqual(reply?.params["text"], REPLIES.unmapped);
        }),
    );

    it.effect(
      "a member's reply in a thread whose task lives is told to it and marked as heard; the bot's own words, other bots' and other threads' never are",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          yield* hq.post(hq.event(mention("<@U0MATE> brew more tea")));
          yield* Queue.take(hq.intake.enqueued);
          const reply = (extra: Record<string, unknown>) =>
            hq.event({
              type: "message",
              channel: "C0SUPPORT",
              channel_type: "channel",
              user: "U0NOVA",
              text: "Green tea, please",
              ts: "1700000000.000200",
              thread_ts: "1700000000.000100",
              ...extra,
            });
          yield* hq.post(reply({}));
          assert.deepStrictEqual(yield* Queue.take(hq.intake.messages), {
            sourceKey: "slack:T0TEA/C0SUPPORT/1700000000.000100",
            message: {
              id: "slack:T0TEA/C0SUPPORT/1700000000.000200",
              from: "reply",
              author: "Nova",
              text: "Green tea, please",
            },
          });
          yield* hq.service.drained;
          assert.deepStrictEqual(
            (yield* hq.slack.callsOf("reactions.add")).map((call) => call.params["timestamp"]),
            ["1700000000.000200"],
          );
          const asked = (yield* hq.slack.callsOf("users.info")).length;
          yield* hq.post(reply({ user: "U0MATE", ts: "1700000000.000300" }));
          yield* hq.post(
            reply({ bot_id: "B0OTHER", subtype: "bot_message", ts: "1700000000.000400" }),
          );
          yield* hq.post(reply({ thread_ts: "1700000000.000999", ts: "1700000000.000500" }));
          yield* hq.post(reply({ thread_ts: undefined, ts: "1700000000.000600" }));
          yield* hq.service.drained;
          assert.strictEqual(yield* Queue.size(hq.intake.messages), 0);
          assert.strictEqual((yield* hq.slack.callsOf("users.info")).length, asked);
          for (const line of hq.logged) assert.notInclude(line, SLACK_BOT_TOKEN);
        }),
    );

    it.effect(
      "a member's reply in a thread whose task ended is answered once, in the thread, with how it ended and how to ask again",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          yield* hq.post(hq.event(mention("<@U0MATE> brew more tea")));
          const asked = yield* Queue.take(hq.intake.enqueued);
          const reply = (ts: string, user = "U0NOVA") =>
            hq.event({
              type: "message",
              channel: "C0SUPPORT",
              channel_type: "channel",
              user,
              text: "And the green one?",
              ts,
              thread_ts: "1700000000.000100",
            });
          const said = Effect.map(hq.slack.callsOf("chat.postMessage"), (calls) =>
            calls.map((call) => [call.params["thread_ts"], call.params["text"]]),
          );
          hq.intake.live.delete(asked.sourceKey);
          hq.intake.ended.set(asked.sourceKey, { kind: "finished" });
          // Someone who may not steer it hears nothing, and the end stays unanswered.
          hq.slack.state.users.set("U0GUEST", {
            email: "nova@acme.test",
            name: "Gus",
            guest: true,
          });
          yield* hq.post(reply("1700000000.000150", "U0GUEST"));
          yield* hq.service.drained;
          assert.deepStrictEqual(yield* said, []);
          yield* hq.post(reply("1700000000.000200"));
          yield* hq.post(reply("1700000000.000300"));
          yield* hq.service.drained;
          assert.deepStrictEqual(yield* said, [
            [
              "1700000000.000100",
              "This task is finished. Mention @Mate in a new message to start another.",
            ],
          ]);
          hq.intake.ended.set(asked.sourceKey, {
            kind: "stopped",
            why: "It reached its $5 limit.",
          });
          yield* hq.post(reply("1700000000.000400"));
          yield* hq.service.drained;
          assert.deepStrictEqual((yield* said).at(-1), [
            "1700000000.000100",
            "This task stopped: It reached its $5 limit. Mention @Mate in a new message to try again.",
          ]);
        }),
    );

    it.effect(
      "a task stops when its ask is deleted, never when someone else's message it answered is",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          const deletion = (ts: string) =>
            hq.event({
              type: "message",
              subtype: "message_deleted",
              channel: "C0SUPPORT",
              deleted_ts: ts,
              ts: "1700000000.000900",
            });
          // Nova asks in a thread someone else began.
          yield* hq.post(
            hq.event(
              mention("<@U0MATE> brew more tea", {
                ts: "1700000000.000200",
                thread_ts: "1700000000.000100",
              }),
            ),
          );
          const asked = yield* Queue.take(hq.intake.enqueued);
          yield* hq.post(deletion("1700000000.000100"));
          yield* hq.post(
            hq.event({
              type: "message",
              subtype: "message_changed",
              channel: "C0SUPPORT",
              message: { ts: "1700000000.000100", subtype: "tombstone" },
              ts: "1700000000.000901",
            }),
          );
          yield* hq.service.drained;
          assert.strictEqual(yield* Queue.size(hq.intake.stops), 0);
          yield* hq.post(deletion("1700000000.000200"));
          assert.deepStrictEqual(yield* Queue.take(hq.intake.stops), {
            sourceKey: asked.sourceKey,
            reason: "The Slack thread was deleted.",
          });
          // Where the thread's first message is the ask, deleting it stops the task too.
          yield* hq.post(hq.event(mention("<@U0MATE> fix the menu", { ts: "1700000000.000300" })));
          const second = yield* Queue.take(hq.intake.enqueued);
          yield* hq.post(deletion("1700000000.000300"));
          assert.strictEqual((yield* Queue.take(hq.intake.stops)).sourceKey, second.sourceKey);
        }),
    );

    it.effect(
      "a task's status is posted in its thread the first time and edited after; a question is put to the person who asked",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          yield* hq.post(hq.event(mention("<@U0MATE> brew more tea")));
          const asked = yield* Queue.take(hq.intake.enqueued);
          const [channel] = hq.registered;
          const task = {
            taskId: "task-1",
            appId: hq.appId,
            source: asked.source,
            sourceKey: asked.sourceKey,
          };
          yield* channel!.status(task, { kind: "queued", position: 2 });
          yield* channel!.status(task, { kind: "picked", mate: "Fen" });
          yield* channel!.status(task, {
            kind: "waiting",
            mate: "Fen",
            question: "Green or black?",
          });
          const posted = yield* hq.slack.callsOf("chat.postMessage");
          assert.deepStrictEqual(
            posted.map((call) => [call.params["thread_ts"], call.params["text"]]),
            [
              ["1700000000.000100", "Queued (#2 in line for a free Mate)."],
              ["1700000000.000100", "<@U0NOVA> Fen asks: Green or black?"],
            ],
          );
          const edits = yield* hq.slack.callsOf("chat.update");
          assert.deepStrictEqual(
            edits.map((call) => call.params["text"]),
            ["Fen picked this up.", "Fen is waiting for an answer. Reply in this thread."],
          );
          assert.deepStrictEqual(
            [...new Set(edits.map((call) => call.params["ts"]))],
            [[...hq.slack.state.messages.keys()][0]],
          );
          // The thread's next task gets a status message of its own.
          yield* channel!.status({ ...task, taskId: "task-2" }, { kind: "queued", position: 1 });
          assert.lengthOf(yield* hq.slack.callsOf("chat.postMessage"), 3);
        }),
    );

    it.effect(
      "each ending a task's Mate gave words for is a message of its own in its thread, the status message edited as before",
      () =>
        Effect.gen(function* () {
          const hq = yield* withSlack;
          yield* hq.connected;
          yield* hq.post(hq.event(mention("<@U0MATE> show me the address")));
          const asked = yield* Queue.take(hq.intake.enqueued);
          const [channel] = hq.registered;
          const task = {
            taskId: "task-1",
            appId: hq.appId,
            source: asked.source,
            sourceKey: asked.sourceKey,
          };
          yield* channel!.status(task, { kind: "picked", mate: "Fen" });
          yield* channel!.status(task, { kind: "done", mate: "Fen", link: null });
          yield* channel!.answer!(task, {
            mate: "Fen",
            words: "It runs at https://appstage.example.",
          });
          const posted = yield* hq.slack.callsOf("chat.postMessage");
          assert.deepStrictEqual(
            posted.map((call) => [call.params["thread_ts"], call.params["text"]]),
            [
              ["1700000000.000100", "Fen picked this up."],
              ["1700000000.000100", "Fen: It runs at https://appstage.example."],
            ],
          );
          assert.deepStrictEqual(
            (yield* hq.slack.callsOf("chat.update")).map((call) => call.params["text"]),
            ["Fen finished this."],
          );
        }),
    );
  });
});
