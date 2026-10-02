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
 * The verdict is read at boot and every 30 s. A read the platform could not answer is `unknown`:
 * it keeps an `ok` for at most ten minutes after that `ok` was read, and never allows otherwise.
 *
 * @module official
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

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
 * `anchor_elsewhere` while any Admin member names another project (person or token, any status:
 * fail closed), else `ok` while an active Admin token names this project and address.
 */
export const anchorVerdict = (
  self: { readonly projectId: string; readonly address: string },
  members: ReadonlyArray<ZeropsMember>,
): "ok" | "anchor_missing" | "anchor_elsewhere" => {
  const anchors = members
    .filter((member) => member.roleCode === "ADMIN" && member.name.startsWith(ANCHOR_PREFIX))
    .map((member) => ({ member, ...parseAnchor(member.name) }));
  if (anchors.some((anchor) => anchor.projectId !== self.projectId)) return "anchor_elsewhere";
  const address = self.address.replace(/\/+$/u, "");
  const own = anchors.some(
    (anchor) =>
      anchor.member.kind === "token" &&
      anchor.member.status === "ACTIVE" &&
      anchor.address === address,
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

export class Official extends Context.Service<
  Official,
  { readonly status: Effect.Effect<OfficialStatus> }
>()("@t3tools/hq/official") {}

export interface OfficialOptions {
  readonly projectId: string;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
  readonly recheck?: Duration.Duration;
  readonly grace?: Duration.Duration;
}

export const officialLayer = (options: OfficialOptions): Layer.Layer<Official, never, ZeropsApi> =>
  Layer.effect(
    Official,
    Effect.gen(function* () {
      const api = yield* ZeropsApi;
      const recheck = options.recheck ?? Duration.seconds(30);
      const grace = Duration.toMillis(options.grace ?? Duration.minutes(10));
      const state = yield* Ref.make<{
        readonly official: OfficialStatus["official"];
        /** When the last verdict was read, if it was `ok`. */
        readonly okAt: number | undefined;
      }>({ official: "unknown", okAt: undefined });

      /** The verdict; a refusal of any read is the credential's fault, an unanswered read none. */
      const read = Effect.gen(function* () {
        if (Option.isNone(options.credential)) return "credentials_wrong" as const;
        const credential = options.credential.value;
        const own = yield* api.ownToken(credential);
        const project = yield* api.project(options.projectId)(credential);
        if (!credentialFits(own, project.orgId)) return "credentials_wrong" as const;
        return anchorVerdict(
          { projectId: options.projectId, address: `https://${project.publicZone}` },
          yield* api.members(project.orgId)(credential),
        );
      }).pipe(
        Effect.catchTags({
          ZeropsRefused: () => Effect.succeed("credentials_wrong" as const),
          ZeropsUnavailable: () => Effect.succeed("unknown" as const),
        }),
      );

      const check = Effect.gen(function* () {
        const official = yield* read;
        const now = yield* Clock.currentTimeMillis;
        yield* Ref.update(state, (current) => ({
          official,
          okAt: official === "ok" ? now : official === "unknown" ? current.okAt : undefined,
        }));
      });
      yield* Effect.forkScoped(Effect.repeat(check, Schedule.spaced(recheck)));

      return Official.of({
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
