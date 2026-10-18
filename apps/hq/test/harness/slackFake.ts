// @effect-diagnostics nodeBuiltinImport:off -- Slack's Web API, as HQ reaches it: over HTTP.
/**
 * Slack's Web API in miniature for the tests: a workspace with its bot, its people and channels;
 * what HQ asked of it (each method, its form, the token it came with), and messages posted and
 * edited as Slack keeps them.
 *
 * @module test/harness/slackFake
 */
import * as NodeHttp from "node:http";

import * as Effect from "effect/Effect";

export interface SlackCall {
  readonly method: string;
  readonly authorization: string | undefined;
  readonly params: Readonly<Record<string, string>>;
}

export interface FakeSlackUser {
  readonly email: string | null;
  readonly name: string;
  readonly bot?: boolean;
  /** Whether Slack confirmed the email; yes unless said otherwise. */
  readonly emailConfirmed?: boolean;
  readonly deleted?: boolean;
  /** A user of a workspace this one shares no channel membership with (Slack Connect). */
  readonly stranger?: boolean;
  /** A guest: of several channels (`true`) or of one. */
  readonly guest?: boolean | "single-channel";
  /** The workspace the user belongs to; the fake's own unless said otherwise. */
  readonly teamId?: string;
}

/** A fake bot token, built from parts so no scanner takes it for one. */
export const SLACK_BOT_TOKEN = ["xoxb", "1000", "2000", "fakefakefakefake"].join("-");

export const slackFake = Effect.gen(function* () {
  const state = {
    calls: [] as Array<SlackCall>,
    team: { id: "T0TEA", name: "Tea Shop" },
    botUserId: "U0MATE",
    /** The token `auth.test` takes; any other is `invalid_auth`. */
    token: SLACK_BOT_TOKEN,
    users: new Map<string, FakeSlackUser>(),
    channels: new Map<string, { readonly name: string; readonly member: boolean }>(),
    /** The messages HQ posted, by ts, as last edited. */
    messages: new Map<
      string,
      { readonly channel: string; readonly threadTs: string; text: string }
    >(),
    posted: 0,
  };
  const answer = (call: SlackCall): unknown => {
    if (call.authorization !== `Bearer ${state.token}`) return { ok: false, error: "invalid_auth" };
    const { params } = call;
    switch (call.method) {
      case "auth.test":
        return {
          ok: true,
          team: state.team.name,
          team_id: state.team.id,
          user_id: state.botUserId,
          bot_id: "B0MATE",
        };
      case "conversations.info": {
        const channel = state.channels.get(params["channel"] ?? "");
        return channel === undefined
          ? { ok: false, error: "channel_not_found" }
          : {
              ok: true,
              channel: { id: params["channel"], name: channel.name, is_member: channel.member },
            };
      }
      case "users.info": {
        const user = state.users.get(params["user"] ?? "");
        return user === undefined
          ? { ok: false, error: "user_not_found" }
          : {
              ok: true,
              user: {
                id: params["user"],
                team_id: user.teamId ?? state.team.id,
                name: user.name.toLowerCase(),
                is_bot: user.bot === true,
                is_email_confirmed: user.emailConfirmed ?? true,
                deleted: user.deleted === true,
                is_restricted: user.guest !== undefined && user.guest !== false,
                is_ultra_restricted: user.guest === "single-channel",
                ...(user.stranger === true ? { is_stranger: true } : {}),
                profile: {
                  team: user.teamId ?? state.team.id,
                  display_name: user.name,
                  real_name: user.name,
                  ...(user.email === null ? {} : { email: user.email }),
                },
              },
            };
      }
      case "chat.getPermalink":
        return {
          ok: true,
          permalink: `https://teashop.slack.com/archives/${params["channel"] ?? ""}/p${(params["message_ts"] ?? "").replace(".", "")}`,
        };
      case "chat.postMessage": {
        state.posted += 1;
        const ts = `1800000000.${String(state.posted).padStart(6, "0")}`;
        state.messages.set(ts, {
          channel: params["channel"] ?? "",
          threadTs: params["thread_ts"] ?? "",
          text: params["text"] ?? "",
        });
        return { ok: true, channel: params["channel"], ts };
      }
      case "chat.update": {
        const message = state.messages.get(params["ts"] ?? "");
        if (message === undefined) return { ok: false, error: "message_not_found" };
        message.text = params["text"] ?? "";
        return { ok: true, channel: params["channel"], ts: params["ts"] };
      }
      case "reactions.add":
        return { ok: true };
      default:
        return { ok: false, error: "unknown_method" };
    }
  };
  const { url } = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ server: NodeHttp.Server; url: string }>((resolve) => {
          const server = NodeHttp.createServer((request, response) => {
            let text = "";
            request.on("data", (chunk: Buffer) => {
              text += chunk.toString("utf8");
            });
            request.on("end", () => {
              const call: SlackCall = {
                method: (request.url ?? "").replace(/^\/api\//u, ""),
                authorization: request.headers["authorization"],
                params: Object.fromEntries(new URLSearchParams(text)),
              };
              state.calls.push(call);
              response.writeHead(200, { "content-type": "application/json" });
              response.end(JSON.stringify(answer(call)));
            });
          }).listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address && typeof address !== "string")
              resolve({ server, url: `http://127.0.0.1:${address.port}/api` });
          });
        }),
    ),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  /** The calls of `method` HQ made, in order. */
  const callsOf = (method: string) =>
    Effect.sync(() => state.calls.filter((call) => call.method === method));
  return { url, state, callsOf };
});
