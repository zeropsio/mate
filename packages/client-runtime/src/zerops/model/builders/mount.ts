import { operationClosing } from "../../operations/phrases.ts";
import type { ZeropsCall } from "../types.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  detailField,
  errorInfoFor,
  firstLine,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  undecodedDetail,
} from "./shared.ts";

export function buildMountFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "mount" ? decoded.card : undefined;
  const phase = phaseFor(call.status);
  const hostnames = card?.mounts.map((m) => m.hostname) ?? [];
  const subject = hostnames.length > 0 ? hostnames.join(", ") : "the services";
  const { voice, voiceSource } = mateVoiceFor("mount", subject);

  const steps = (card?.mounts ?? []).map((mount) =>
    buildStep(mount.hostname, mount.hostname, mount.mounted ? "ACTIVE" : "FAILED", mount.mountPath),
  );
  const mountedCount = (card?.mounts ?? []).filter((m) => m.mounted).length;

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("mount", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done"
          ? card !== undefined
            ? operationClosing("mount", "done", { mountedCount, mountsTotal: card.mounts.length })
            : "Finished."
          : operationClosing("mount", phase, {});

  return {
    subject,
    kicker: `${KIND_LABEL.mount} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord("mount", phase, card !== undefined, call.resultText !== undefined),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(call) : undefined,
    ]),
    ...(hostnames[0] !== undefined ? { target: { hostname: hostnames[0] } } : {}),
    hasResult: decoded.document !== undefined,
  };
}
