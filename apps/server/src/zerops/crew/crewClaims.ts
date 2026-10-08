/**
 * crewClaims — the engine's part of Show on dev (ARCHITECTURE §5 *Show on
 * dev*, CONCEPT §3.3); `CrewRuntime` holds the claim and reads what dev
 * serves.
 *
 * A crewmate asks with `crew_show_on_dev`; the person grants (`claimGrant`)
 * and the engine sends one shaped turn to the holder: restart the service's
 * dev server from its copy, in exactly the form the gate lets through. The
 * release is the same turn from the tree — on *Back to my tree*, or once the
 * holder reports its task done (after that turn ends). After either turn,
 * what dev serves settles the claim: held, back to none, or a failed release.
 * The person's own `zerops_dev_server`, or a self-deploy, ends a held claim:
 * the person wins.
 *
 * The gate reads `holdsClaim` from memory at every call; every claim change
 * here refreshes that memory before anything else runs.
 *
 * @module crewClaims
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { claimReleaseCard, claimStartCard, type DevServerShape } from "./crewCards.ts";
import {
  asRefusal,
  failureWords,
  isWorking,
  memberOf,
  principalUser,
  refuse,
  requireApplied,
  type AppliedCrew,
  type CrewCore,
} from "./crewCore.ts";
import { crewLane } from "./CrewDefinition.ts";
import { CREW_ID } from "./CrewHome.ts";
import { remember } from "./crewNotes.ts";
import { readDeclaredPorts } from "./crewPorts.ts";
import type { CrewClaimPress } from "./CrewRuntime.ts";
import type { CrewThreadMember } from "./crewSeams.ts";
import { sendTurn, stintForTurn } from "./crewTasks.ts";

/** Reads every claim of the crew into memory, where the gate and the snapshot read them. */
export const refreshClaims = (core: CrewCore) =>
  asRefusal(core.store.claims(CREW_ID)).pipe(
    Effect.tap((rows) =>
      Effect.sync(() => {
        core.memory.claims.clear();
        for (const row of rows) {
          core.memory.claims.set(row.host, {
            state: row.state,
            handle: row.member,
            grantedBy: row.grantedBy,
            requestedAt: row.requestedAt,
          });
        }
        for (const host of Array.from(core.memory.showReasons.keys())) {
          if (core.memory.claims.get(host)?.state !== "requested") {
            core.memory.showReasons.delete(host);
          }
        }
      }),
    ),
    Effect.andThen(core.changed),
  );

/** Whether a crewmate's work is on its way to dev, shown there, or on its way back. */
export const claimShown = (core: CrewCore, handle: string): boolean =>
  [...core.memory.claims.values()].some(
    (claim) =>
      claim.handle === handle &&
      (claim.state === "starting" || claim.state === "held" || claim.state === "releasing"),
  );

/** The dev server a shaped turn restarts: zcp's running command, on the service's own port. */
export const devServerShape = (core: CrewCore, host: string) =>
  Effect.gen(function* () {
    const command = yield* asRefusal(core.reads.devServerCommand(host));
    const yaml = yield* asRefusal(core.reads.zeropsYaml(host));
    const port = yaml === undefined ? null : (readDeclaredPorts(yaml, host)?.main ?? null);
    return command === undefined || port === null
      ? undefined
      : ({ port, command } satisfies DevServerShape);
  });

/** `crew_show_on_dev`: the request, and the answer the model reads. */
/** A request nobody answers ends by itself (ARCHITECTURE §4 *Show-on-dev claim*: deny or 10 min). */
export const CLAIM_REQUEST_TIMEOUT = Duration.minutes(10);

/** The host of a writer's copy, or undefined for a crewmate without one. */
const hostOf = (core: CrewCore, handle: string) =>
  Effect.map(requireApplied(core), (applied) => {
    const row = applied.members.get(handle);
    return row?.kind === "writer" ? (row.host ?? undefined) : undefined;
  });

/**
 * Records a request on the claimant's host, with why it asks; a request still
 * standing after {@link CLAIM_REQUEST_TIMEOUT} times out.
 */
const request = (core: CrewCore, handle: string, reason: string | null) =>
  Effect.gen(function* () {
    const host = yield* hostOf(core, handle);
    const requested = yield* asRefusal(core.runtime.request({ crew: CREW_ID, handle, host }));
    if (requested.outcome.kind === "requested" && host !== undefined) {
      if (reason !== null) core.memory.showReasons.set(host, reason);
      yield* refreshClaims(core);
      const requestedAt = core.memory.claims.get(host)?.requestedAt;
      yield* Effect.forkIn(
        Effect.sleep(CLAIM_REQUEST_TIMEOUT).pipe(
          Effect.andThen(
            core.background(
              Effect.gen(function* () {
                const claim = core.memory.claims.get(host);
                // An *Allow* waiting on the crewmate's turn keeps the request standing.
                if (
                  claim?.state === "requested" &&
                  claim.requestedAt === requestedAt &&
                  !core.memory.grantsWaiting.has(host)
                ) {
                  yield* moveClaim(core, host, "timeout");
                }
              }),
            ),
          ),
        ),
        core.scope,
      );
    } else {
      yield* refreshClaims(core);
    }
    return { ...requested, host };
  });

/** `crew_show_on_dev`: the request, and the answer the model reads. */
export const showOnDev = (
  core: CrewCore,
  member: CrewThreadMember,
  input: { readonly reason: string },
) => Effect.map(request(core, member.handle, input.reason), (requested) => requested.answer);

/**
 * *Show on dev* pressed by the person (`showOnDev {handle}`): the crewmate's
 * request and the person's grant at once, the claim turn sent as them — at
 * the end of the crewmate's turn when one runs.
 */
export const showOnDevNow = (core: CrewCore, principal: TurnPrincipal, handle: string) =>
  Effect.gen(function* () {
    const { outcome, answer, host } = yield* request(core, handle, null);
    if (host === undefined || (outcome.kind !== "requested" && outcome.kind !== "pending")) {
      if (outcome.kind === "shown") return;
      return yield* refuse("wrong-state", answer.text);
    }
    yield* grantClaim(core, principal, host);
  });

/** Reads what dev serves on `host` and moves its claim by it. */
export const settleClaim = (core: CrewCore, host: string) =>
  Effect.gen(function* () {
    const served = yield* asRefusal(core.runtime.served(host));
    core.memory.served.set(host, served);
    yield* asRefusal(core.runtime.settle(host));
    yield* refreshClaims(core);
  });

const sendShaped = (
  core: CrewCore,
  principal: TurnPrincipal,
  host: string,
  handle: string,
  kind: "claim-start" | "claim-release",
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = memberOf(applied, handle);
    const repository = applied.repositories.get(host);
    if (member === undefined || repository === undefined) {
      return yield* refuse("unknown-crewmate", `@${handle}`);
    }
    const shape = yield* devServerShape(core, host);
    if (shape === undefined) {
      return yield* refuse("wrong-state", noDevServer(applied, host, handle));
    }
    const stint = yield* stintForTurn(core, applied, member, "turn-start", false);
    core.memory.shaped.set(stint.threadId, { turn: kind, devServer: shape });
    yield* sendTurn(
      core,
      member,
      stint,
      principal,
      kind === "claim-start"
        ? claimStartCard({
            host,
            devServer: shape,
            workDir: crewLane(repository, handle).remoteDir,
          })
        : claimReleaseCard({ host, devServer: shape }),
    ).pipe(Effect.tapError(() => Effect.sync(() => core.memory.shaped.delete(stint.threadId))));
  });

/**
 * Why a claim cannot start: the dev service runs no dev server zcp started
 * (Show on dev restarts that one), and the way out — the Mate starts it, or
 * the crewmate's own app on its crew port shows its work meanwhile.
 */
const noDevServer = (applied: AppliedCrew, host: string, handle: string): string => {
  const row = applied.members.get(handle);
  const app =
    row?.crewPort == null ? "" : `, or open ${row.displayName}'s own app on :${row.crewPort}`;
  return `${host} has no dev server started by your Mate — ask your Mate to start it${app}`;
};

/** A waiting *Allow* is gone: sent, or its claim moved on. */
const settleGrant = (core: CrewCore, host: string) =>
  core.memory.grantsWaiting.has(host)
    ? remember(core, { kind: "grant-settled", host }, null)
    : Effect.void;

/**
 * *Allow*: the claim starts and its holder gets the claim turn, as the person
 * who allowed it. A crewmate asks while it works, so an *Allow* pressed
 * during its turn is kept and goes out when the turn ends.
 */
export const grantClaim = (core: CrewCore, principal: TurnPrincipal, host: string) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const claim = core.memory.claims.get(host);
    if (claim?.state !== "requested" || claim.handle === null) {
      return yield* refuse("wrong-state", `nobody asks to show work on ${host}`);
    }
    if (isWorking(core, applied, claim.handle)) {
      yield* remember(core, { kind: "grant-waiting", host, principal }, null);
      return;
    }
    yield* settleGrant(core, host);
    if ((yield* devServerShape(core, host)) === undefined) {
      return yield* refuse("wrong-state", noDevServer(applied, host, claim.handle));
    }
    yield* asRefusal(core.runtime.grant(host, principalUser(principal)));
    yield* refreshClaims(core);
    yield* sendShaped(core, principal, host, claim.handle, "claim-start");
  });

/** A press or an event that moves a claim without reading dev (deny, the person's own dev server, a deploy). */
export const moveClaim = (core: CrewCore, host: string, event: CrewClaimPress) =>
  Effect.gen(function* () {
    yield* settleGrant(core, host);
    yield* asRefusal(core.runtime.apply(host, event));
    yield* refreshClaims(core);
  });

/**
 * *Back to my tree*, or the holder's done report: the claim releases, and the
 * release turn goes to the holder now — or when its running turn ends.
 */
export const releaseClaim = (
  core: CrewCore,
  principal: TurnPrincipal,
  host: string,
  event: Extract<CrewClaimPress, "press" | "report">,
) =>
  Effect.gen(function* () {
    const claim = core.memory.claims.get(host);
    if (claim === undefined || claim.handle === null) {
      return yield* refuse("wrong-state", `${host} shows nobody's work`);
    }
    if (claim.state === "held") yield* moveClaim(core, host, event);
    const applied = yield* requireApplied(core);
    if (!isWorking(core, applied, claim.handle)) {
      yield* sendShaped(core, principal, host, claim.handle, "claim-release");
    }
  });

/** At a turn's end: an *Allow* pressed during it goes out now, as whoever pressed it. */
export const grantAfterTurn = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    for (const [host, principal] of core.memory.grantsWaiting) {
      if (core.memory.claims.get(host)?.handle !== handle) continue;
      yield* grantClaim(core, principal, host).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            core.memory.lastError = failureWords(error);
          }),
        ),
      );
    }
  });

/** At a turn's end: a release waiting on the holder's turn goes out now, as whoever granted it. */
export const releaseAfterTurn = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    for (const [host, claim] of core.memory.claims) {
      if (claim.handle !== handle || claim.state !== "releasing") continue;
      yield* sendShaped(
        core,
        { kind: "crew", startedBy: claim.grantedBy ?? "" },
        host,
        handle,
        "claim-release",
      );
    }
  });

/** Every claim settles against what dev serves, as at boot. */
export const settleAllClaims = (core: CrewCore) =>
  Effect.gen(function* () {
    yield* refreshClaims(core);
    // Settling refreshes the map, so iterate a copy of its keys.
    for (const host of Array.from(core.memory.claims.keys())) {
      yield* settleClaim(core, host).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            core.memory.lastError = failureWords(error);
          }),
        ),
      );
    }
  });
