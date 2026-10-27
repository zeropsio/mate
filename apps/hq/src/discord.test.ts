// @effect-diagnostics nodeBuiltinImport:off -- the tests sign as Discord does, with Ed25519.
import * as NodeCrypto from "node:crypto";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import type { MateTaskMessage } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TEST_KEY_SECRET } from "../test/harness/deployKeys.ts";
import { discordFake } from "../test/harness/discordFake.ts";
import { seedCoreWorld } from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { keySecretOf } from "./deployKeys.ts";
import { Discord, discordLayer } from "./discord.ts";
import { discordApiLayer } from "./discordApi.ts";
import { rolesLayer } from "./roles.ts";
import {
  type TaskEnqueue,
  type TaskSourceChannel,
  TaskIntake,
  TaskSourceChannels,
} from "./taskSources.ts";
import { ZeropsApi } from "./zerops/api.ts";

const APPLICATION_ID = "1100000000000000001";
/** A fake bot token, built from parts so no scanner takes it for one. */
const BOT_TOKEN = ["MTEwMDAw", "ZmFrZQ", "ZGlzY29yZC1ib3QtdG9rZW4"].join(".");
const GUILD = "1200000000000000001";
const CHANNEL = "1300000000000000001";
const OTHER_CHANNEL = "1300000000000000002";
const NOVA = { id: "1400000000000000001", username: "nova", global_name: "Nova" };
const GUEST = { id: "1400000000000000002", username: "guest", global_name: null };

/** The application's key pair: Discord signs with the private half, HQ checks with the public. */
const keys = NodeCrypto.generateKeyPairSync("ed25519");
const PUBLIC_KEY = Buffer.from(
  keys.publicKey.export({ format: "jwk" }).x ?? "",
  "base64url",
).toString("hex");

/** A delivery of `interaction`, signed as Discord signs it now — or as `forge` says. */
const signed = (
  interaction: unknown,
  forge: { readonly ago?: number; readonly key?: NodeCrypto.KeyObject } = {},
) =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    const timestamp = String(Math.floor(now / 1000) - (forge.ago ?? 0));
    const body = new TextEncoder().encode(JSON.stringify(interaction));
    const signature = NodeCrypto.sign(
      null,
      Buffer.concat([Buffer.from(timestamp, "utf8"), body]),
      forge.key ?? keys.privateKey,
    ).toString("hex");
    return { signature, timestamp, body };
  });

let interactions = 0;
/** `/mate <sub> text:<text>` by `user`, in `channel` (a thread, where `type` says so). */
const command = (
  sub: string,
  text: string,
  at: { readonly channel?: string; readonly name?: string; readonly type?: number } = {},
  user: {
    readonly id: string;
    readonly username: string;
    readonly global_name: string | null;
  } = NOVA,
) => {
  interactions += 1;
  const channel = at.channel ?? CHANNEL;
  return {
    id: `150000000000000${String(1000 + interactions)}`,
    type: 2,
    application_id: APPLICATION_ID,
    token: `interaction-token-${String(interactions)}`,
    guild_id: GUILD,
    channel_id: channel,
    channel: { id: channel, name: at.name ?? "tea-shop", type: at.type ?? 0 },
    member: { nick: null, user },
    data: {
      id: "1600000000000000001",
      name: "mate",
      type: 1,
      options: [{ type: 1, name: sub, options: [{ type: 3, name: "text", value: text }] }],
    },
  };
};

/** What the asker alone reads of an answer. */
const ephemeralWords = (answer: unknown) => {
  const body = answer as { type: number; data?: { content?: string; flags?: number } };
  assert.strictEqual(body.type, 4);
  assert.strictEqual(body.data?.flags, 64);
  return body.data?.content ?? "";
};

/** Waits until `found` gives something; fails after ten seconds. */
const until = <A>(what: string, found: () => A | undefined) =>
  Effect.suspend(() => {
    const value = found();
    return value === undefined ? Effect.fail(what) : Effect.succeed(value);
  }).pipe(
    Effect.retry(Schedule.spaced(Duration.millis(20))),
    Effect.timeout(Duration.seconds(10)),
    Effect.orDie,
  );

/**
 * Discord as a source over a leading Core's database, the organization's roles (an owner, a
 * Developer, a reader), Discord's API in miniature and HQ's door for sources faked: what was asked
 * of it, and the channel Discord registered.
 */
const withDiscord = Effect.gen(function* () {
  const fake = yield* discordFake({
    id: APPLICATION_ID,
    publicKey: PUBLIC_KEY,
    botToken: BOT_TOKEN,
  });
  fake.state.guilds.set(GUILD, "Acme");
  fake.state.channels.set(CHANNEL, { id: CHANNEL, name: "tea-shop", type: 0, guildId: GUILD });
  fake.state.channels.set(OTHER_CHANNEL, {
    id: OTHER_CHANNEL,
    name: "voice",
    type: 2,
    guildId: GUILD,
  });
  const asked = {
    enqueued: [] as Array<TaskEnqueue>,
    messages: [] as Array<readonly [string, MateTaskMessage]>,
    stops: [] as Array<readonly [string, string]>,
  };
  const registered = new Map<string, TaskSourceChannel>();
  const intake = Layer.succeed(
    TaskIntake,
    TaskIntake.of({
      enqueue: (input) =>
        Effect.sync(() => {
          asked.enqueued.push(input);
          return {
            kind: "queued",
            taskId: `task-${String(asked.enqueued.length)}`,
            position: asked.enqueued.length,
          } as const;
        }),
      message: (sourceKey, message) =>
        Effect.sync(() => {
          const live = asked.enqueued.some((task) => task.sourceKey === sourceKey);
          if (live) asked.messages.push([sourceKey, message]);
          return live;
        }),
      stop: (sourceKey, reason) => Effect.sync(() => void asked.stops.push([sourceKey, reason])),
      answerEnded: () => Effect.undefined,
    }),
  );
  const channels = Layer.succeed(
    TaskSourceChannels,
    TaskSourceChannels.of({
      register: (channel) => Effect.sync(() => void registered.set(channel.kind, channel)),
      of: (kind) => Effect.sync(() => registered.get(kind)),
    }),
  );
  const url = yield* (yield* TempPostgres).createDatabase;
  const credential = Option.some(Redacted.make("hq"));
  const context = yield* Layer.build(
    discordLayer({
      hqProjectId: "HQ1",
      keySecret: keySecretOf(Option.some(Redacted.make(TEST_KEY_SECRET))),
    }).pipe(
      Layer.provide(discordApiLayer(fake.url).pipe(Layer.provide(NodeHttpClient.layerNodeHttp))),
      Layer.provide(intake),
      Layer.provide(channels),
      Layer.provide(rolesLayer({ hqProjectId: "HQ1", credential })),
      Layer.provide(
        Layer.succeed(
          ZeropsApi,
          fakeZeropsApi(seedCoreWorld(yield* Clock.currentTimeMillis, true, "ORG")),
        ),
      ),
      Layer.provideMerge(activeCoreLayer(url)),
    ),
  );
  yield* untilActive.pipe(Effect.provide(context));
  const discord = Context.get(context, Discord);
  const sql = Context.get(context, SqlClient.SqlClient);
  const connect = discord.connect("owner", {
    applicationId: APPLICATION_ID,
    publicKey: PUBLIC_KEY,
    botToken: BOT_TOKEN,
  });
  /** The organization's Discord connected, Nova on its list, `Tea Shop` taking `#tea-shop`. */
  const ready = Effect.gen(function* () {
    const view = yield* connect;
    yield* discord.allow("owner", { userIds: [NOVA.id] });
    const [app] = yield* sql<{ readonly id: string }>`
      INSERT INTO hq_app (name, created_by) VALUES ('Tea Shop', 'owner') RETURNING id::text AS id`;
    yield* discord.keepChannel("owner", app!.id, { channelId: CHANNEL });
    const publicId = view.interactionsUrl.split("/").at(-1) ?? "";
    return { view, appId: app!.id, publicId };
  });
  return { discord, fake, asked, registered, sql, connect, ready };
});

/** Every line logged while `effect` ran. */
const logged = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    const value = yield* effect.pipe(
      Effect.provide(
        Logger.layer([Logger.make(({ message }) => void lines.push(JSON.stringify(message)))]),
      ),
    );
    return { value, lines };
  });

describe("Discord as a source of tasks", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "an owner of the organization connects its Discord application: HQ checks the bot token with Discord, registers /mate, and answers where Discord sends interactions and how to invite the bot, never the token",
      () =>
        Effect.gen(function* () {
          const { value: run, lines } = yield* logged(
            Effect.gen(function* () {
              const world = yield* withDiscord;
              const view = yield* world.connect;
              return { world, view };
            }),
          );
          const { world, view } = run;
          assert.isTrue(view.connected);
          assert.match(
            view.interactionsUrl,
            /^https:\/\/hqzone\.prg1-zerops\.zone\/api\/intake\/discord\/[\w-]{20,}$/u,
          );
          assert.strictEqual(
            view.inviteUrl,
            `https://discord.com/oauth2/authorize?client_id=${APPLICATION_ID}&scope=bot%20applications.commands&permissions=309237713984`,
          );
          assert.deepStrictEqual(view.allowed, []);
          const seen = world.fake.state.seen;
          assert.deepInclude(seen[0], { method: "GET", path: "/applications/@me" });
          const registered = seen.find((request) => request.method === "PUT");
          assert.strictEqual(registered?.path, `/applications/${APPLICATION_ID}/commands`);
          const [mate] = (registered?.body ?? []) as ReadonlyArray<{
            name: string;
            options: ReadonlyArray<{ name: string; options: ReadonlyArray<{ name: string }> }>;
          }>;
          assert.strictEqual(mate?.name, "mate");
          assert.deepStrictEqual(
            mate?.options.map((sub) => [sub.name, sub.options.map((option) => option.name)]),
            [
              ["task", ["text"]],
              ["reply", ["text"]],
            ],
          );
          const [row] = yield* world.sql<{ readonly sealed: string; readonly public_key: string }>`
            SELECT encode(sealed, 'escape') AS sealed, public_key FROM hq_discord`;
          assert.notInclude(row!.sealed, BOT_TOKEN);
          assert.strictEqual(row!.public_key, PUBLIC_KEY);
          assert.notInclude(JSON.stringify(view), BOT_TOKEN);
          for (const line of lines) assert.notInclude(line, BOT_TOKEN);
          // Connecting the same application again keeps its address.
          const again = yield* world.connect;
          assert.strictEqual(again.interactionsUrl, view.interactionsUrl);
        }),
    );

    it.effect(
      "a bot token Discord refuses, or an id or public key of another application, connects nothing",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const other = Buffer.from(
            NodeCrypto.generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x ?? "",
            "base64url",
          ).toString("hex");
          const attempts = [
            { applicationId: APPLICATION_ID, publicKey: PUBLIC_KEY, botToken: "not-the-token" },
            { applicationId: "1100000000000000009", publicKey: PUBLIC_KEY, botToken: BOT_TOKEN },
            { applicationId: APPLICATION_ID, publicKey: other, botToken: BOT_TOKEN },
            { applicationId: APPLICATION_ID, publicKey: "zz", botToken: BOT_TOKEN },
          ];
          const reasons: Array<string> = [];
          for (const request of attempts) {
            const refused = yield* Effect.flip(world.discord.connect("owner", request));
            reasons.push(refused._tag === "AutomationRefused" ? refused.reason : refused._tag);
          }
          assert.deepStrictEqual(reasons, [
            "bot_token",
            "application_id",
            "public_key",
            "public_key",
          ]);
          assert.isFalse((yield* world.discord.view).connected);
          assert.isUndefined(world.fake.state.seen.find((request) => request.method === "PUT"));
        }),
    );

    it.effect(
      "only an owner or admin of the organization connects Discord or says who may ask Mate there",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          for (const userId of ["dev", "reader"]) {
            const connecting = yield* Effect.flip(
              world.discord.connect(userId, {
                applicationId: APPLICATION_ID,
                publicKey: PUBLIC_KEY,
                botToken: BOT_TOKEN,
              }),
            );
            const listing = yield* Effect.flip(world.discord.allow(userId, { userIds: [NOVA.id] }));
            const disconnecting = yield* Effect.flip(world.discord.disconnect(userId));
            for (const refused of [connecting, listing, disconnecting])
              assert.deepInclude(refused, { _tag: "AutomationRefused", code: "forbidden" });
          }
          assert.deepStrictEqual(world.fake.state.seen, []);
          const listed = yield* world.discord.allow("owner", {
            userIds: [NOVA.id, NOVA.id, GUEST.id],
          });
          assert.deepStrictEqual(listed.allowed, [NOVA.id, GUEST.id]);
          const relisted = yield* world.discord.allow("owner", { userIds: [GUEST.id] });
          assert.deepStrictEqual(relisted.allowed, [GUEST.id]);
        }),
    );

    it.effect(
      "an application takes tasks from the one Discord channel set for it, a text channel Discord shows the bot",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const [app] = yield* world.sql<{ readonly id: string }>`
            INSERT INTO hq_app (name, created_by) VALUES ('Shop Front', 'owner')
            RETURNING id::text AS id`;
          const appId = app!.id;
          const early = yield* Effect.flip(
            world.discord.keepChannel("owner", appId, { channelId: CHANNEL }),
          );
          assert.deepInclude(early, { code: "conflict", reason: "not_connected" });
          yield* world.connect;
          const kept = yield* world.discord.keepChannel("owner", appId, { channelId: CHANNEL });
          assert.deepStrictEqual(kept, { appId, channelId: CHANNEL, channel: "tea-shop" });
          assert.deepStrictEqual(yield* world.discord.channelOf(appId), kept);
          const reasons: Array<string> = [];
          for (const channelId of [OTHER_CHANNEL, "1300000000000000404", "general"]) {
            const refused = yield* Effect.flip(
              world.discord.keepChannel("owner", appId, { channelId }),
            );
            reasons.push(refused._tag === "AutomationRefused" ? refused.reason : refused._tag);
          }
          assert.deepStrictEqual(reasons, ["channel_kind", "channel_not_found", "channel_id"]);
          const byDev = yield* Effect.flip(
            world.discord.keepChannel("dev", appId, { channelId: CHANNEL }),
          );
          assert.deepInclude(byDev, { code: "forbidden" });
          yield* world.discord.dropChannel("owner", appId);
          assert.isUndefined(yield* world.discord.channelOf(appId));
        }),
    );

    it.effect(
      "an interaction whose Ed25519 signature does not hold, or that is too old, is refused; one to no connection is not found",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const { publicId } = yield* world.ready;
          const ping = { id: "1500000000000000001", type: 1 };
          const good = yield* signed(ping);
          const deliveries = [
            { ...good, signature: undefined },
            { ...good, signature: "00".repeat(64) },
            yield* signed(ping, { key: NodeCrypto.generateKeyPairSync("ed25519").privateKey }),
            yield* signed(ping, { ago: 600 }),
            { ...good, body: new TextEncoder().encode(JSON.stringify({ ...ping, type: 2 })) },
          ];
          for (const delivery of deliveries)
            assert.deepStrictEqual(yield* world.discord.interact(publicId, delivery), {
              kind: "refused",
            });
          assert.deepStrictEqual(yield* world.discord.interact("no-such-connection", good), {
            kind: "unknown",
          });
          assert.deepStrictEqual(world.asked.enqueued, []);
        }),
    );

    it.effect("Discord's ping is answered with a pong", () =>
      Effect.gen(function* () {
        const world = yield* withDiscord;
        const { publicId } = yield* world.ready;
        assert.deepStrictEqual(
          yield* world.discord.interact(
            publicId,
            yield* signed({ id: "1500000000000000001", type: 1 }),
          ),
          { kind: "answer", body: { type: 1 } },
        );
      }),
    );

    it.effect(
      "/mate task in the application's channel, by someone on the list, is answered at once, opens a thread on that answer and asks HQ for the task, the thread its conversation",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const { appId, publicId } = yield* world.ready;
          const asked = command("task", "Make the tea hotter");
          const answer = yield* world.discord.interact(publicId, yield* signed(asked));
          assert.deepStrictEqual(answer, { kind: "answer", body: { type: 5 } });
          const task = yield* until("the task asked", () => world.asked.enqueued[0]);
          const seen = world.fake.state.seen;
          const said = seen.find((request) => request.method === "PATCH");
          assert.strictEqual(
            said?.path,
            `/webhooks/${APPLICATION_ID}/${asked.token}/messages/@original`,
          );
          assert.deepInclude(said?.body as object, { content: "On it: Make the tea hotter" });
          const opened = seen.find((request) => request.path.endsWith("/threads"));
          assert.match(
            opened?.path ?? "",
            new RegExp(`^/channels/${CHANNEL}/messages/\\d+/threads$`, "u"),
          );
          assert.deepInclude(opened?.body as object, { name: "Make the tea hotter" });
          assert.strictEqual(opened?.authorization, `Bot ${BOT_TOKEN}`);
          const thread = task.sourceKey.replace(/^discord:/u, "");
          assert.match(thread, /^\d+$/u);
          assert.deepStrictEqual(task, {
            appId,
            source: {
              kind: "discord-thread",
              server: "Acme",
              channel: "tea-shop",
              url: `https://discord.com/channels/${GUILD}/${thread}`,
              title: "Make the tea hotter",
              author: "Nova",
            },
            body: "Make the tea hotter",
            sourceKey: `discord:${thread}`,
            deliveryId: `discord:${asked.id}`,
            requestedBy: null,
          });
        }),
    );

    it.effect(
      "/mate reply in a task's thread tells its task, and everyone in the thread reads what was said",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const { publicId } = yield* world.ready;
          yield* world.discord.interact(
            publicId,
            yield* signed(command("task", "Make the tea hotter")),
          );
          const task = yield* until("the task asked", () => world.asked.enqueued[0]);
          const thread = task.sourceKey.replace(/^discord:/u, "");
          const reply = command("reply", "Oolong, please", {
            channel: thread,
            name: "Make the tea hotter",
            type: 11,
          });
          const told = yield* world.discord.interact(publicId, yield* signed(reply));
          assert.strictEqual(told.kind, "answer");
          assert.deepStrictEqual(told.kind === "answer" ? told.body : null, {
            type: 4,
            data: { content: "Nova: Oolong, please", allowed_mentions: { parse: [] } },
          });
          assert.deepStrictEqual(world.asked.messages, [
            [
              task.sourceKey,
              { id: `discord:${reply.id}`, from: "reply", author: "Nova", text: "Oolong, please" },
            ],
          ]);
          const elsewhere = yield* world.discord.interact(
            publicId,
            yield* signed(command("reply", "Hello?", { channel: "1700000000000000001", type: 11 })),
          );
          assert.match(
            ephemeralWords(elsewhere.kind === "answer" ? elsewhere.body : null),
            /no task/u,
          );
        }),
    );

    it.effect(
      "someone not on the list, a channel set for no application, or a task's own thread are refused in words only the asker sees, and ask nothing",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const { publicId } = yield* world.ready;
          const answers = [
            command("task", "Make the tea hotter", {}, GUEST),
            command("reply", "Oolong, please", { channel: "1700000000000000001", type: 11 }, GUEST),
            command("task", "Make the tea hotter", {
              channel: "1300000000000000003",
              name: "general",
            }),
            command("task", "Make the tea hotter", { channel: "1700000000000000001", type: 11 }),
          ];
          const words: Array<string> = [];
          for (const asked of answers) {
            const answer = yield* world.discord.interact(publicId, yield* signed(asked));
            words.push(ephemeralWords(answer.kind === "answer" ? answer.body : null));
          }
          assert.match(words[0]!, /not on the list/u);
          assert.match(words[1]!, /not on the list/u);
          assert.match(words[2]!, /takes no tasks/u);
          assert.match(words[3]!, /\/mate reply/u);
          assert.deepStrictEqual(world.asked.enqueued, []);
          assert.deepStrictEqual(world.asked.messages, []);
          assert.deepStrictEqual(
            world.fake.state.seen.filter(
              (request) => request.method !== "GET" && request.method !== "PUT",
            ),
            [],
          );
        }),
    );

    it.effect(
      "a task's status is one message of the bot's in its thread, posted the first time and edited after",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const { appId } = yield* world.ready;
          const channel = world.registered.get("discord-thread");
          assert.isDefined(channel);
          const task = {
            taskId: "task-1",
            appId,
            sourceKey: "discord:1700000000000000001",
            source: {
              kind: "discord-thread",
              server: "Acme",
              channel: "tea-shop",
              url: `https://discord.com/channels/${GUILD}/1700000000000000001`,
              title: "Make the tea hotter",
              author: "Nova",
            },
          } as const;
          yield* channel!.status(task, { kind: "queued", position: 2 });
          yield* channel!.status(task, { kind: "picked", mate: "Fen" });
          yield* channel!.status(task, {
            kind: "change",
            mate: "Fen",
            link: "https://mate.zerops.io/c/1",
          });
          const inThread = world.fake.state.seen.filter((request) =>
            request.path.startsWith("/channels/1700000000000000001/messages"),
          );
          assert.deepStrictEqual(
            inThread.map((request) => [
              request.method,
              (request.body as { content: string }).content,
              (request.body as { allowed_mentions: unknown }).allowed_mentions,
            ]),
            [
              ["POST", "Waiting for a free Mate: #2 in line.", { parse: [] }],
              ["PATCH", "Fen picked this up.", { parse: [] }],
              [
                "PATCH",
                "Fen opened a change for review: https://mate.zerops.io/c/1",
                { parse: [] },
              ],
            ],
          );
          const edited = new Set(inThread.slice(1).map((request) => request.path));
          assert.strictEqual(edited.size, 1);
        }),
    );

    it.effect(
      "each ending a task's Mate gave words for is a new message in its thread under the status line: its words, as a reply reads, and the new commit its change took, cut to Discord's limit with its code block closed",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const { appId } = yield* world.ready;
          const channel = world.registered.get("discord-thread")!;
          const task = {
            taskId: "task-1",
            appId,
            sourceKey: "discord:1700000000000000001",
            source: {
              kind: "discord-thread",
              server: "Acme",
              channel: "tea-shop",
              url: `https://discord.com/channels/${GUILD}/1700000000000000001`,
              title: "Show me the address",
              author: "Nova",
            },
          } as const;
          yield* channel.status(task, { kind: "done", mate: "Fen", link: null });
          yield* channel.answer!(task, {
            mate: "Fen",
            words: "It runs at https://appstage.example.",
          });
          yield* channel.status(task, {
            kind: "done",
            mate: "Fen",
            link: "https://mate.zerops.io/c/19",
          });
          yield* channel.answer!(task, {
            mate: "Fen",
            words: `Reworked the footer:\n\`\`\`css\n${"footer { color: navy; }\n".repeat(120)}\`\`\``,
            pushed: { number: 19, link: "https://mate.zerops.io/c/19" },
          });
          const inThread = world.fake.state.seen
            .filter((request) => request.path.startsWith("/channels/1700000000000000001/messages"))
            .map((request) => [request.method, (request.body as { content: string }).content]);
          assert.deepStrictEqual(inThread.slice(0, 3), [
            ["POST", "Fen finished this."],
            ["POST", "Fen: It runs at https://appstage.example."],
            ["PATCH", "Fen finished this: https://mate.zerops.io/c/19"],
          ]);
          const [method, cut] = inThread[3]!;
          assert.strictEqual(method, "POST");
          assert.isAtMost(cut!.length, 2000);
          assert.match(cut!, /^Fen: Reworked the footer:\n```css\nfooter/u);
          assert.match(
            cut!,
            /footer \{ color: navy; \}\n```\n…\n\nNew commit on change #19: https:\/\/mate\.zerops\.io\/c\/19$/u,
          );
        }),
    );

    it.effect("a task whose thread was deleted in Discord is stopped, saying so", () =>
      Effect.gen(function* () {
        const world = yield* withDiscord;
        const { appId } = yield* world.ready;
        const channel = world.registered.get("discord-thread")!;
        const task = {
          taskId: "task-1",
          appId,
          sourceKey: "discord:1700000000000000001",
          source: {
            kind: "discord-thread",
            server: "Acme",
            channel: "tea-shop",
            url: `https://discord.com/channels/${GUILD}/1700000000000000001`,
            title: "Make the tea hotter",
            author: "Nova",
          },
        } as const;
        yield* channel.status(task, { kind: "queued", position: 1 });
        world.fake.state.deleted.add("1700000000000000001");
        yield* channel.status(task, { kind: "picked", mate: "Fen" });
        const stop = yield* until("the task stopped", () => world.asked.stops[0]);
        assert.deepStrictEqual(stop, ["discord:1700000000000000001", "The thread was deleted."]);
      }),
    );

    it.effect(
      "disconnected, the organization's Discord takes no interaction and /mate leaves Discord",
      () =>
        Effect.gen(function* () {
          const world = yield* withDiscord;
          const { publicId } = yield* world.ready;
          yield* world.discord.disconnect("owner");
          const view = yield* world.discord.view;
          assert.deepStrictEqual(view, {
            connected: false,
            interactionsUrl: "",
            inviteUrl: null,
            allowed: [NOVA.id],
          });
          const removed = world.fake.state.seen.findLast((request) => request.method === "PUT");
          assert.deepStrictEqual(removed?.body, []);
          assert.deepStrictEqual(
            yield* world.discord.interact(
              publicId,
              yield* signed({ id: "1500000000000000001", type: 1 }),
            ),
            { kind: "unknown" },
          );
        }),
    );
  });
});
