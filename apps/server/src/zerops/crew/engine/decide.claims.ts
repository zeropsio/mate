/**
 * Show on dev: a crewmate's claim on a dev service from request to release, and the read of what the dev server serves.
 *
 * @module crew/engine/decide.claims
 */
import { type Principal } from "@t3tools/contracts";
import { claimTransition, type ClaimEvent } from "../crewMachines.ts";
import { claimReleaseCard, claimStartCard } from "./cards.ts";
import { copyWorkDir } from "../crewShowOnDev.ts";
import { type CrewEffectValues } from "./command.ts";
import { runningRun, type MemberRecord, type PendingEffect } from "./state.ts";
import { wrongState, type Builder, crewAs } from "./decide.step.ts";
import { sendTurn } from "./decide.turns.ts";

/** How long a Show-on-dev request waits for the person's answer. */
export const CLAIM_REQUEST_TIMEOUT_MS = 10 * 60_000;

export const moveClaim = (b: Builder, host: string, event: ClaimEvent): boolean => {
  const claim = b.state.claims[host];
  const from = claim?.state ?? "none";
  const moved = claimTransition(from, event);
  if (moved.kind !== "moved") return false;
  if (moved.to === "none") {
    b.emit({ _tag: "ClaimUpdated", host, claim: null });
    b.cancel("claim-timeout", host, "the claim ended");
  } else if (claim !== undefined) {
    b.emit({ _tag: "ClaimUpdated", host, claim: { ...claim, state: moved.to } });
  }
  return true;
};

export const requestClaim = (b: Builder, member: MemberRecord, reason: string | null): void => {
  const host = member.host!;
  const claim = b.state.claims[host];
  if (claim !== undefined && claim.state !== "none") {
    if (claim.handle === member.handle && claim.state === "requested") return;
    throw wrongState(`${host} already shows @${claim.handle}'s work or is asked for`);
  }
  b.emit({
    _tag: "ClaimUpdated",
    host,
    claim: {
      state: "requested",
      handle: member.handle,
      requestedAt: b.now,
      reason,
      grantWaiting: false,
      devServer: null,
      workDir: null,
      grantedBy: null,
    },
  });
  b.arm("claim-timeout", host, b.now + CLAIM_REQUEST_TIMEOUT_MS, b.envelope.principal);
};

/** *Allow*: the dev server's shape is read first; the claim turn goes when its crewmate is free. */
/**
 * Why a claim cannot start (V1's words): the dev service runs no dev server the Mate started,
 * and the way out — the Mate starts it, or the crewmate's own app on its crew port meanwhile.
 */
export const noDevServerWords = (host: string, member: MemberRecord | undefined): string =>
  `${host} has no dev server started by your Mate — ask your Mate to start it${
    member?.crewPort == null
      ? ""
      : `, or open ${member.displayName}'s own app on :${member.crewPort}`
  }`;

export const grantClaim = (b: Builder, host: string, as: Principal): void => {
  const claim = b.state.claims[host];
  if (claim?.state !== "requested") throw wrongState(`${host} has no request`);
  b.emit({ _tag: "ClaimUpdated", host, claim: { ...claim, grantedBy: as } });
  b.effect({ kind: "crew.claim.read", host, handle: claim.handle, purpose: "grant" }, host, {
    host,
    handle: claim.handle,
  });
};

export const releaseClaim = (
  b: Builder,
  host: string,
  as: Principal,
  event: "press" | "report" | "timeout",
): void => {
  const claim = b.state.claims[host];
  if (claim === undefined || !moveClaim(b, host, event)) {
    if (event === "press") throw wrongState(`${host} shows your tree`);
    return;
  }
  const member = b.state.members[claim.handle];
  if (member === undefined || claim.devServer === null) return;
  sendTurn(
    b,
    member,
    claimReleaseCard(host, member.handle, claim.devServer),
    as,
    "claim-release",
    null,
  );
};

/** A free crewmate's allowed claim turn goes out; a running run's dev grant allows a request. */
export const claimTurn = (b: Builder, member: MemberRecord): boolean => {
  if (member.host === null) return false;
  const claim = b.state.claims[member.host];
  if (claim === undefined || claim.handle !== member.handle) return false;
  if (claim.state === "requested" && claim.grantWaiting && claim.devServer !== null) {
    moveClaim(b, member.host, "grant");
    b.emit({
      _tag: "ClaimUpdated",
      host: member.host,
      claim: { ...b.state.claims[member.host]!, grantWaiting: false },
    });
    sendTurn(
      b,
      member,
      claimStartCard(
        member.host,
        member.handle,
        claim.devServer,
        claim.workDir ?? copyWorkDir(member.handle, claim.devServer),
      ),
      claim.grantedBy ?? b.envelope.principal,
      "claim-start",
      null,
    );
    return true;
  }
  const run = runningRun(b.state);
  if (
    claim.state === "requested" &&
    claim.grantedBy === null &&
    run !== undefined &&
    run.options.devGrant
  ) {
    grantClaim(b, member.host, crewAs(run.startedBy));
    return true;
  }
  return false;
};

export const claimRead = (
  b: Builder,
  pending: PendingEffect,
  read: CrewEffectValues["crew.claim.read"],
): void => {
  const host = pending.host!;
  b.emit({ _tag: "HostUpdated", host, set: { served: read.served } });
  const claim = b.state.claims[host];
  if (claim === undefined) return;
  const purpose = (pending.payload as { purpose?: string }).purpose;
  switch (purpose) {
    case "grant": {
      if (claim.state !== "requested") return;
      if (read.devServer === null) {
        b.emit({
          _tag: "ErrorNoted",
          text: noDevServerWords(host, b.state.members[claim.handle]),
        });
        b.emit({ _tag: "ClaimUpdated", host, claim: { ...claim, grantedBy: null } });
        return;
      }
      b.emit({
        _tag: "ClaimUpdated",
        host,
        claim: { ...claim, devServer: read.devServer, workDir: read.workDir, grantWaiting: true },
      });
      return;
    }
    case "after-start": {
      const servesLane = read.served.by === "crewmate" && read.served.handle === claim.handle;
      moveClaim(b, host, servesLane ? "serves-lane" : "serves-other");
      if (b.state.claims[host]?.state === "releasing" && claim.devServer !== null) {
        const member = b.state.members[claim.handle];
        if (member !== undefined) {
          sendTurn(
            b,
            member,
            claimReleaseCard(host, member.handle, claim.devServer),
            claim.grantedBy ?? { kind: "engine" },
            "claim-release",
            null,
          );
        }
      }
      return;
    }
    case "after-release":
      moveClaim(b, host, read.served.by === "tree" ? "serves-tree" : "turn-failed");
      return;
    case "import": {
      // A claim V1 held: still held while the dev server serves its crewmate's copy.
      if (claim.state !== "held") return;
      if (read.served.by === "crewmate" && read.served.handle === claim.handle) {
        b.emit({
          _tag: "ClaimUpdated",
          host,
          claim: { ...claim, devServer: read.devServer, workDir: read.workDir },
        });
      } else {
        b.emit({ _tag: "ClaimUpdated", host, claim: null });
      }
      return;
    }
    default:
      return;
  }
};
