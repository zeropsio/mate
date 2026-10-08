import { completionReceipt } from "@t3tools/shared/completionReceipt";
/**
 * Which HQ is the official one. An org Admin or Owner mints the anchor: an integration token named
 * `mate-hq:<projectId>:<address>` with the org role Admin, its value discarded. The member list
 * every member can read carries its name and role (T0 §2), so Core reads it with its own working
 * credential and may lead only while the anchor names its own project and address and no Admin
 * `mate-hq:*` names another project.
 *
 * Core's address is its project's own domain, `https://<publicZone>`, read with the project: a Mate's
 * calls and git pushes reach it through the project's own balancer, not the shared `zerops.app`
 * one with its 50 MB body cap (T3c).
 *
 * The verdict is read at boot, then every minute while it is `ok` and every 30 s while it is not,
 * and each change of it is logged. The members and the project come from the org's view every
 * reader shares (`roles.ts`'s `recent`), the credential's own token every ten minutes: HQ read
 * KRLS's member list of 181 a dozen times a minute before (the lead, 2026-10-03). A read the
 * platform could not answer is `unknown`: it keeps an `ok` for at most ten minutes after that `ok`
 * was read, and never allows otherwise. Until the platform first answers this Core, the `ok` the Core
 * that led before held counts as its own (`inherit`, recorded in `hq_leader` by `leader.ts`): a
 * takeover does not wait on a Zerops that is slow to answer the new container (F18).
 *
 * @module official
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";

import { Roles } from "./roles.ts";
import { ZeropsApi, type ZeropsMember, type ZeropsOwnToken } from "./zerops/api.ts";

const ANCHOR_PREFIX = "mate-hq:";

/** `<projectId>` and `<address>` of an anchor name; the address holds `:` itself. */
const parseAnchor = (name: string) => {
  const rest = name.slice(ANCHOR_PREFIX.length);
  const split = rest.indexOf(":");
  return split < 0
    ? { projectId: rest, address: "" }
    : { projectId: rest.slice(0, split), address: rest.slice(split + 1).replace(/\/+$/u, "") };
};

/**
 * Only an integration token is an anchor: a person who names themselves like one names nothing.
 * `anchor_elsewhere` while any Admin token names another project (any status: fail closed), else
 * `ok` while an active Admin token names this project and address.
 */
export const anchorVerdict = (
  self: { readonly projectId: string; readonly address: string },
  members: ReadonlyArray<ZeropsMember>,
): "ok" | "anchor_missing" | "anchor_elsewhere" => {
  const anchors = members
    .filter(
      (member) =>
        member.kind === "token" &&
        member.roleCode === "ADMIN" &&
        member.name.startsWith(ANCHOR_PREFIX),
    )
    .map((member) => ({ member, ...parseAnchor(member.name) }));
  if (anchors.some((anchor) => anchor.projectId !== self.projectId)) return "anchor_elsewhere";
  const address = self.address.replace(/\/+$/u, "");
  const own = anchors.some(
    (anchor) => anchor.member.status === "ACTIVE" && anchor.address === address,
  );
  return own ? "ok" : "anchor_missing";
};

/** Core's working credential: a token of the HQ's org, Read only, with no project grant and no flag. */
export const credentialFits = (own: ZeropsOwnToken, orgId: string): boolean =>
  own.orgId === orgId &&
  own.roleCode === "READ_ONLY" &&
  !own.canCreateProjects &&
  !own.canViewFinances &&
  !own.canEditFinances &&
  own.projects.length === 0;

export interface OfficialStatus {
  /** The last read's verdict; `unknown` when the platform could not answer it. */
  readonly official: "ok" | "anchor_missing" | "anchor_elsewhere" | "credentials_wrong" | "unknown";
  /** Whether this Core may lead now. */
  readonly allowed: boolean;
}

/** An `ok` read: when, and of which HQ project. */
export interface OfficialOk {
  readonly at: number;
  readonly projectId: string;
}

export class Official extends Context.Service<
  Official,
  {
    readonly status: Effect.Effect<OfficialStatus>;
    /**
     * Whether this Core's first check has finished, whatever it answered: until then `unknown` is
     * no verdict, only the state a Core starts in.
     */
    readonly checked: Effect.Effect<boolean>;
    /** The next scheduled official-verdict read and its state publication have completed. */
    readonly nextCheck: Effect.Effect<void>;
    /** The newest `ok` this Core holds, read or inherited: what the leader records for the next. */
    readonly lastOk: Effect.Effect<OfficialOk | undefined>;
    /**
     * The `ok` the Core that led before read (`leader.ts` records it): this Core's own until it
     * has an answer of its own.
     */
    readonly inherit: (ok: OfficialOk) => Effect.Effect<void>;
  }
>()("@t3tools/hq/official") {}

export interface OfficialOptions {
  readonly projectId: string;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
  /** How often the verdict is read while it is not `ok`; 30 s. */
  readonly recheck?: Duration.Duration;
  /** How often it is read while it is `ok`; a minute. */
  readonly recheckOk?: Duration.Duration;
  /** How long the credential's own token is held to fit, once read so; ten minutes. */
  readonly fitHeld?: Duration.Duration;
  readonly grace?: Duration.Duration;
}

export const officialLayer = (
  options: OfficialOptions,
): Layer.Layer<Official, never, ZeropsApi | Roles> =>
  Layer.effect(
    Official,
    Effect.gen(function* () {
      const api = yield* ZeropsApi;
      const roles = yield* Roles;
      const recheck = options.recheck ?? Duration.seconds(30);
      const recheckOk = options.recheckOk ?? Duration.minutes(1);
      const fitHeld = Duration.toMillis(options.fitHeld ?? Duration.minutes(10));
      const grace = Duration.toMillis(options.grace ?? Duration.minutes(10));
      /** When the credential's own token was last read to fit; none until it was, or once not. */
      const fitAt = yield* Ref.make<number | undefined>(undefined);
      const checked = yield* Ref.make(false);
      const state = yield* Ref.make<{
        readonly official: OfficialStatus["official"];
        /** When the last verdict was read, if it was `ok`. */
        readonly okAt: number | undefined;
        /** Whether the platform has answered this Core: from then on its own verdicts rule. */
        readonly answered: boolean;
      }>({ official: "unknown", okAt: undefined, answered: false });

      /** Whether the credential's own token fits, read again once the last fitting read is old. */
      const fits = (credential: Redacted.Redacted, orgId: string) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const at = yield* Ref.get(fitAt);
          if (at !== undefined && now - at < fitHeld) return true;
          const fit = credentialFits(yield* api.ownToken(credential), orgId);
          yield* Ref.set(fitAt, fit ? now : undefined);
          return fit;
        });

      /** The verdict; a refusal of any read is the credential's fault, an unanswered read none. */
      const read = Effect.gen(function* () {
        if (Option.isNone(options.credential)) return "credentials_wrong" as const;
        const view = yield* roles.recent;
        const project = view.projects.find((candidate) => candidate.id === options.projectId);
        if (project === undefined) return "credentials_wrong" as const;
        if (!(yield* fits(options.credential.value, view.orgId))) {
          return "credentials_wrong" as const;
        }
        return anchorVerdict(
          { projectId: options.projectId, address: `https://${project.publicZone}` },
          view.members,
        );
      }).pipe(
        Effect.catchTags({
          ZeropsRefused: () => Effect.succeed("credentials_wrong" as const),
          ZeropsUnavailable: () => Effect.succeed("unknown" as const),
        }),
      );

      const completed = completionReceipt();
      const check = Effect.gen(function* () {
        const official = yield* read;
        const now = yield* Clock.currentTimeMillis;
        const was = yield* Ref.getAndUpdate(state, (current) => ({
          official,
          okAt: official === "ok" ? now : official === "unknown" ? current.okAt : undefined,
          answered: current.answered || official !== "unknown",
        }));
        yield* Ref.set(checked, true);
        if (was.official !== official) {
          yield* Effect.logInfo("official verdict changed", { from: was.official, to: official });
        }
        return official;
      }).pipe(Effect.ensuring(completed.complete));
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(check, (official) =>
            Effect.sleep(official === "ok" ? recheckOk : recheck),
          ),
        ),
      );

      return Official.of({
        nextCheck: Effect.suspend(completed.next),
        checked: Ref.get(checked),
        lastOk: Effect.map(Ref.get(state), ({ okAt }) =>
          okAt === undefined ? undefined : { at: okAt, projectId: options.projectId },
        ),
        inherit: (ok) =>
          ok.projectId !== options.projectId
            ? Effect.void
            : Effect.flatMap(
                Ref.modify(state, (current) =>
                  current.answered || (current.okAt !== undefined && current.okAt >= ok.at)
                    ? [false, current]
                    : [true, { ...current, okAt: ok.at }],
                ),
                (taken) =>
                  taken
                    ? Effect.logInfo("official ok taken from the Core that led before", {
                        readAt: DateTime.formatIso(DateTime.makeUnsafe(ok.at)),
                      })
                    : Effect.void,
              ),
        status: Effect.gen(function* () {
          const { official, okAt } = yield* Ref.get(state);
          const now = yield* Clock.currentTimeMillis;
          const allowed =
            official === "ok" ||
            (official === "unknown" && okAt !== undefined && now - okAt < grace);
          return { official, allowed };
        }),
      });
    }),
  );
