/**
 * Who may hand an issue to an application's automated Mates, or steer its task (`intake.ts`): a
 * person, not a bot, with write, maintain or admin on the repository (GitHub's collaborator
 * permission, asked with the repository's token). The repository's access is the trust boundary
 * the organization connected; nothing else is asked of them. Who in the organization the task is
 * asked for is attribution only: the active member whose email their GitHub profile shows (GitHub
 * lets a profile show only a verified email), or nobody — never a reason to refuse. The answer is
 * kept five minutes per repository and person; GitHub unreachable on the permission is no answer
 * (`undefined`), so nothing is taken in on a guess.
 *
 * @module githubGate
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

import { GithubIssues } from "./githubIssues.ts";
import type { RemoteIdentity } from "./gitTransport.ts";
import { Roles } from "./roles.ts";

/** What GitHub says of the person who acted. */
export interface GithubActor {
  readonly login: string;
  /** `Bot` for an app's or a bot's account. */
  readonly type?: string | undefined;
}

export type GateVerdict =
  /** One who can write to the repository; the member it maps to by email, or nobody. */
  | { readonly kind: "writer"; readonly userId: string | null }
  /** A bot: never a trigger, never told why. */
  | { readonly kind: "bot" }
  /** A person who may not, and why, in words for the issue. */
  | { readonly kind: "refused"; readonly why: string };

/** The repository roles that may hand an issue to Mate. */
const WRITERS = new Set(["admin", "maintain", "write"]);
const KEPT_FOR = Duration.minutes(5);
const KEPT_MAX = 500;

/** Why a person may not, said on the issue. */
export const notWriter = (login: string) =>
  `@${login} can't hand issues to Mate here: only people who can write to this repository can.`;

export class GithubGate extends Context.Service<
  GithubGate,
  {
    /** Whether `actor` may steer Mate on `remote`'s issues; `undefined` while GitHub does not answer. */
    readonly verdict: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      actor: GithubActor,
    ) => Effect.Effect<GateVerdict | undefined>;
  }
>()("@t3tools/hq/githubGate") {}

export const githubGateLayer = Layer.effect(
  GithubGate,
  Effect.gen(function* () {
    const github = yield* GithubIssues;
    const roles = yield* Roles;
    const kept = new Map<string, { readonly verdict: GateVerdict; readonly at: number }>();
    const keptMs = Duration.toMillis(KEPT_FOR);

    const asked = (remote: RemoteIdentity, token: Redacted.Redacted, actor: GithubActor) =>
      Effect.gen(function* () {
        const login = actor.login;
        if (actor.type === "Bot" || login.endsWith("[bot]")) return { kind: "bot" } as const;
        const permission = yield* github.permission(remote, token, login);
        if (permission.status !== 200 && permission.status !== 404) return undefined;
        if (permission.role === undefined || !WRITERS.has(permission.role))
          return { kind: "refused", why: notWriter(login) } as const;
        // Attribution only: a profile GitHub does not show now is nobody's.
        const user = yield* github
          .user(remote, token, login)
          .pipe(Effect.orElseSucceed(() => undefined));
        if (user?.bot === true) return { kind: "bot" } as const;
        const email = user?.status === 200 ? user.email : undefined;
        const members = yield* Effect.orElseSucceed(
          Effect.map(roles.view, (view) => view.members),
          () => [],
        );
        const member =
          email === undefined
            ? undefined
            : members.find(
                (candidate) =>
                  candidate.kind === "person" &&
                  candidate.status === "ACTIVE" &&
                  candidate.email === email,
              );
        return { kind: "writer", userId: member?.userId ?? null } as const;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning("a GitHub person not checked", { cause }), undefined),
        ),
      );

    return GithubGate.of({
      verdict: (remote, token, actor) =>
        Effect.gen(function* () {
          const key = `${remote.host}/${remote.path}\u0000${actor.login.toLowerCase()}`;
          const now = yield* Clock.currentTimeMillis;
          const held = kept.get(key);
          if (held !== undefined && now - held.at < keptMs) return held.verdict;
          const verdict = yield* asked(remote, token, actor);
          if (verdict === undefined) return undefined;
          if (kept.size >= KEPT_MAX) kept.clear();
          kept.set(key, { verdict, at: now });
          return verdict;
        }),
    });
  }),
);
