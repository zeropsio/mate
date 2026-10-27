import { zcpVersionText } from "./zcpVersion.ts";

export interface AutomaticUpdateEvidence {
  readonly enabled: boolean | undefined;
  readonly available: boolean;
  readonly latest: string;
  readonly updater?:
    | {
        readonly protocol: number;
        readonly rollbackCompatible: boolean;
        readonly phase: string;
        readonly runningVersion: string;
        readonly failedVersion?: string;
      }
    | undefined;
}
export function mayAutoUpdate(evidence: AutomaticUpdateEvidence): boolean {
  const updater = evidence.updater;
  return (
    evidence.enabled === true &&
    evidence.available &&
    updater?.protocol === 1 &&
    updater.rollbackCompatible &&
    updater.failedVersion !== evidence.latest &&
    ["idle", "updated", "postponed"].includes(updater.phase)
  );
}

/**
 * One `mate status` reading that only a restart answers, as the key a restart is kept under: the
 * same zcp and mate versions read again after a restart are the same reading, never a second one.
 */
export function restartReading(status: {
  readonly installed: string;
  readonly zcp?: { readonly installed: string; readonly latest: string } | undefined;
}): string {
  const zcp = status.zcp;
  return `zcp ${zcp === undefined ? "?" : zcpVersionText(zcp.installed)} -> ${zcp === undefined ? "?" : zcpVersionText(zcp.latest)}; mate ${status.installed}`;
}

/**
 * Whether the organization's automatic update restarts the container for this reading: allowed,
 * needed, no restart of this Mate already under way, and none already made for the same reading
 * (a container that came back still behind is never restarted again for it).
 */
export function mayAutoRestart(evidence: {
  readonly enabled: boolean | undefined;
  readonly restartNeeded: boolean;
  readonly reading: string;
  readonly restartedFor: string | undefined;
  readonly underWay: boolean;
}): boolean {
  return (
    evidence.enabled === true &&
    evidence.restartNeeded &&
    !evidence.underWay &&
    evidence.restartedFor !== evidence.reading
  );
}
