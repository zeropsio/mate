/**
 * The bootstrap session card — the only multi-call operation. A group's
 * `members` are every call folded into the session (founder first);
 * `operations.ts` owns closure (R7) and passes the already-decided `phase`
 * in, since that decision needs more than one call's own status.
 */
import { readRecord, readRecordArray, readString } from "../../cards/decode.ts";
import type { ZeropsCardPayload } from "../../cards/payloads.ts";
import { operationClosing, operationVoice, sentenceCase } from "../../operations/phrases.ts";
import type { ZeropsCall, ZeropsOperationPhase, ZeropsOperationStep } from "../types.ts";
import {
  type BuiltCardFields,
  type DecodedEntry,
  buildStep,
  detailField,
  errorInfoFor,
  firstLine,
  firstParagraph,
  gatedStatusWord,
  readInputString,
  undecodedDetail,
} from "./shared.ts";
import { readImport } from "./importCard.ts";

export interface BootstrapMember {
  readonly call: ZeropsCall;
  readonly decoded: DecodedEntry;
}

function latestPlan(members: ReadonlyArray<BootstrapMember>):
  | {
      member: BootstrapMember;
      document: Record<string, unknown>;
      card: Extract<ZeropsCardPayload, { kind: "plan" }>;
    }
  | undefined {
  for (let i = members.length - 1; i >= 0; i--) {
    const member = members[i]!;
    if (member.decoded.card?.kind === "plan" && member.decoded.document !== undefined) {
      return { member, document: member.decoded.document, card: member.decoded.card };
    }
  }
  return undefined;
}

/** The latest decoded plan document across `members`, or `undefined` — used for R7 closure. */
export function bootstrapLatestPlanCard(
  members: ReadonlyArray<BootstrapMember>,
): Extract<ZeropsCardPayload, { kind: "plan" }> | undefined {
  return latestPlan(members)?.card;
}

/** R7: the plan's own terminal step — `completed === total` and no `current` left to act on. */
export function bootstrapPlanIsTerminal(members: ReadonlyArray<BootstrapMember>): boolean {
  const plan = latestPlan(members);
  if (plan === undefined) {
    return false;
  }
  return plan.card.completed >= plan.card.total && readRecord(plan.document.current) === undefined;
}

function readAttestation(document: Record<string, unknown>, step: string): string | undefined {
  const current = readRecord(document.current);
  const priorContext = current !== undefined ? readRecord(current.priorContext) : undefined;
  const attestations =
    priorContext !== undefined ? readRecord(priorContext.attestations) : undefined;
  return attestations !== undefined ? readString(attestations[step]) : undefined;
}

function readPlanTargets(
  document: Record<string, unknown>,
): ReadonlyArray<Record<string, unknown>> {
  const current = readRecord(document.current);
  const priorContext = current !== undefined ? readRecord(current.priorContext) : undefined;
  const plan = priorContext !== undefined ? readRecord(priorContext.plan) : undefined;
  return plan !== undefined ? readRecordArray(plan.targets) : [];
}

/** Every hostname a decoded bootstrap document's plan currently names — used by R6's import join. */
export function bootstrapDecodedPlanTargetHostnames(
  document: Record<string, unknown>,
): ReadonlyArray<string> {
  return readPlanTargets(document).flatMap((target) => {
    const runtime = readRecord(target.runtime);
    const hostname = runtime !== undefined ? readString(runtime.devHostname) : undefined;
    return hostname !== undefined ? [hostname] : [];
  });
}

/**
 * The latest member whose result still carries `current.priorContext.plan.targets`.
 *
 * The plan is fixed once `discover` completes, but the session's own LATEST
 * result (typically `close`, once every step is `complete`) reports no
 * `current` step at all — there is nothing left to act on — so it carries no
 * plan either. The kicker still needs the plan, so this looks past the
 * newest result to the last one that had it.
 */
export function bootstrapPlanTargetsDocument(
  members: ReadonlyArray<BootstrapMember>,
): Record<string, unknown> | undefined {
  for (let i = members.length - 1; i >= 0; i--) {
    const document = members[i]!.decoded.document;
    if (document !== undefined && readPlanTargets(document).length > 0) {
      return document;
    }
  }
  return undefined;
}

/**
 * The hostnames a bootstrap kicker names.
 *
 * `route=adopt` names every target — adopting is precisely taking over
 * runtimes that already exist, so "existing" is not a reason to drop one.
 * Otherwise it names only what this bootstrap actually creates: a target
 * whose own runtime is new, plus any dependency the plan resolves as
 * `CREATE`.
 */
function readPlanKickerHostnames(
  document: Record<string, unknown>,
  route: string | undefined,
): string[] {
  const targets = readPlanTargets(document);
  if (route === "adopt") {
    return targets.flatMap((target) => {
      const runtime = readRecord(target.runtime);
      const hostname = runtime !== undefined ? readString(runtime.devHostname) : undefined;
      return hostname !== undefined ? [hostname] : [];
    });
  }
  return targets.flatMap((target) => {
    const runtime = readRecord(target.runtime);
    const hostname = runtime !== undefined ? readString(runtime.devHostname) : undefined;
    const ownHostname = hostname !== undefined && runtime?.isExisting !== true ? [hostname] : [];
    const createdDependencies = readRecordArray(target.dependencies).flatMap((dependency) =>
      readString(dependency.resolution) === "CREATE" &&
      readString(dependency.hostname) !== undefined
        ? [readString(dependency.hostname)!]
        : [],
    );
    return [...ownHostname, ...createdDependencies];
  });
}

const HOSTNAME_TOKEN = /^[a-z0-9]+$/;

/** The bold names in a bootstrap `message`, when the plan's own targets are absent. */
function readMessageBoldNames(message: string): string[] {
  const matches = [...message.matchAll(/\*\*([^*]+)\*\*/g)];
  return matches.flatMap((m) => {
    const token = m[1]?.split(" ")[0]?.trim();
    return token !== undefined && HOSTNAME_TOKEN.test(token) ? [token] : [];
  });
}

function joinedImportProvisionNote(joinedImports: ReadonlyArray<BootstrapMember>): {
  note?: string;
  failed: boolean;
  errorFirstLine?: string;
} {
  if (joinedImports.length === 0) {
    return { failed: false };
  }
  const latest = joinedImports[joinedImports.length - 1]!;
  if (latest.call.status === "failed") {
    const errorInfo = errorInfoFor(latest.call, latest.decoded);
    return {
      failed: true,
      errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : "Import failed.",
    };
  }
  const read = readImport(latest.decoded);
  const note =
    read.hostnames.length === 1
      ? `${read.hostnames[0]} created`
      : `${read.hostnames.length} processes finished`;
  return { note, failed: false };
}

function bootstrapVoiceFor(
  intentInput: string | undefined,
  subject: string,
): { voice: string; voiceSource: "agent" | "mate" } {
  const trimmed = intentInput?.trim();
  if (trimmed !== undefined && trimmed.length > 0 && trimmed.length <= 300) {
    return { voice: trimmed, voiceSource: "agent" };
  }
  return { voice: operationVoice("bootstrap", subject), voiceSource: "mate" };
}

export function buildBootstrapFields(
  members: ReadonlyArray<BootstrapMember>,
  phase: ZeropsOperationPhase,
  joinedImports: ReadonlyArray<BootstrapMember>,
  intent: string | undefined,
): BuiltCardFields {
  const founder = members[0]!;
  const latestMember = members[members.length - 1]!;
  const plan = latestPlan(members);

  const route = readInputString(founder.call.input, "route");
  const targetsDocument = bootstrapPlanTargetsDocument(members);
  const targets =
    targetsDocument !== undefined ? readPlanKickerHostnames(targetsDocument, route) : [];
  const targetHostnames =
    targets.length > 0
      ? targets
      : plan !== undefined && plan.card.message !== undefined
        ? readMessageBoldNames(plan.card.message)
        : [];
  const subject = targetHostnames.length > 0 ? targetHostnames.join(", ") : "the project";

  const kicker =
    route === "adopt"
      ? `Adopt · ${subject}`
      : targetHostnames.length === 1
        ? `New service · ${targetHostnames[0]}`
        : targetHostnames.length > 1
          ? `New services · ${targetHostnames.length}`
          : "New service";

  const { voice, voiceSource } = bootstrapVoiceFor(intent, subject);
  const errorInfo = errorInfoFor(latestMember.call, latestMember.decoded);
  const joinedImportInfo = joinedImportProvisionNote(joinedImports);

  // A pending continuation (no result yet) names the step it targets in its
  // own `input.step` — the latest known plan can't reflect that yet, so it
  // renders as running regardless of what that plan last said about it.
  const pendingStep =
    latestMember.call.status === "inProgress"
      ? readInputString(latestMember.call.input, "step")
      : undefined;

  const stepIndexRunning =
    plan !== undefined ? plan.card.steps.findIndex((s) => s.status === "in_progress") : -1;
  const trailingFailure =
    plan !== undefined
      ? members.slice(members.indexOf(plan.member) + 1).find((m) => m.call.status === "failed")
      : members.length === 1 && founder.call.status === "failed"
        ? founder
        : undefined;

  const steps: ZeropsOperationStep[] =
    plan === undefined
      ? []
      : plan.card.steps.map((step, index) => {
          const label = sentenceCase(step.name);
          if (pendingStep === step.name) {
            return buildStep(step.name, label, "in_progress");
          }
          const attestation = readAttestation(plan.document, step.name);
          const importNote = step.name === "provision" ? joinedImportInfo.note : undefined;
          const note = attestation ?? importNote;
          if (trailingFailure !== undefined && index === stepIndexRunning) {
            const failureInfo = errorInfoFor(trailingFailure.call, trailingFailure.decoded);
            return buildStep(
              step.name,
              label,
              "FAILED",
              failureInfo !== undefined ? firstLine(failureInfo.message) : undefined,
            );
          }
          if (
            step.name === "provision" &&
            joinedImportInfo.failed &&
            step.status === "in_progress"
          ) {
            return buildStep(step.name, label, "FAILED", joinedImportInfo.errorFirstLine);
          }
          return buildStep(step.name, label, step.status, note);
        });

  const messageFirstParagraph =
    plan?.card.message !== undefined ? firstParagraph(plan.card.message) : undefined;

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("bootstrap", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done"
          ? operationClosing("bootstrap", "done", { messageFirstParagraph })
          : operationClosing("bootstrap", phase, {});

  return {
    subject,
    kicker,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "bootstrap",
      phase,
      plan !== undefined,
      latestMember.call.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      plan !== undefined ? readString(plan.document.nextActions) : undefined,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      founder.decoded.card === undefined ? undecodedDetail(founder.call) : undefined,
    ]),
    ...(targetHostnames[0] !== undefined ? { target: { hostname: targetHostnames[0] } } : {}),
    hasResult: plan !== undefined,
  };
}
