import type { ProviderDriverKind } from "@t3tools/contracts";

/** The current catalog's display evidence; chosen identifiers alone cannot supply a label. */
export interface ComposerControlLook {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly label: {
    readonly model: string;
    readonly traits: ReadonlyArray<string>;
    readonly fast: boolean;
  };
}
export function composerControl(input: {
  readonly resolved: ComposerControlLook | null;
  readonly pending: boolean;
}) {
  return input.resolved !== null
    ? { kind: "known" as const, look: input.resolved }
    : input.pending
      ? { kind: "unknown" as const }
      : { kind: "unselected" as const };
}
