import { vaultName, type VaultPart } from "./vault.logic";

/**
 * A part's name as its heading says it: "Shared vault" and the Mate's own ("Fen's vault") in the
 * heading's own face; an app's by its hostname, which is a service's real name and stands in the
 * face of names, then "vault".
 */
export function VaultPartName({
  scope,
  mateName = null,
  size = "heading",
}: {
  readonly scope: VaultPart;
  /** The Mate whose own vault it may be, as the menu names it; `null` where none is known. */
  readonly mateName?: string | null;
  /** Where it stands: a part's heading in the drawer, or a row of a card that leads to it. */
  readonly size?: "heading" | "row";
}) {
  if (scope.kind !== "runtime") return vaultName(scope, mateName);
  return (
    // One run of text, so a heading that lays its children out in a row keeps the words together.
    <span>
      {/* A step under the words beside it: the mono face reads no larger than they do. */}
      <span className={size === "heading" ? "font-mono text-sm" : "font-mono text-caption"}>
        {scope.hostname}
      </span>{" "}
      vault
    </span>
  );
}
