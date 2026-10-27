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
