import type { VaultScope } from "@t3tools/client-runtime/data";

import { vaultName } from "./vault.logic";

/**
 * A part's name as its heading says it: "Shared vault" in the heading's own face; an app's by its
 * hostname, which is a service's real name and stands in the face of names, then "vault".
 */
export function VaultPartName({
  scope,
  size = "heading",
}: {
  readonly scope: Pick<VaultScope, "hostname">;
  /** Where it stands: a part's heading in the drawer, or a row of a card that leads to it. */
  readonly size?: "heading" | "row";
}) {
  if (scope.hostname === null) return vaultName(scope);
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
