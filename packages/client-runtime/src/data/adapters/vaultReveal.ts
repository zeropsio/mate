/**
 * A sensitive vault value, decrypted for the person who asked to see it
 * (`GET /project-env/{id}/reveal`, `GET /user-data/{id}/reveal`). The value goes to the caller and
 * nowhere else: never the store, never browser storage, never a log, never a Mate. Zerops reveals
 * only in sudo mode; this client's personal access token is always in it, and a member who may
 * not read secrets is refused with the platform's code.
 *
 * @module data/adapters/vaultReveal
 */
import { ZeropsApiError, type ZeropsApiClient } from "../../zerops/api.ts";
import type { VaultScopeRef } from "../projections/vaultModel.ts";

export type VaultRevealed =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly code: string | null };

export interface VaultReveal {
  readonly reveal: (scope: VaultScopeRef, id: string) => Promise<VaultRevealed>;
}

export function makeVaultReveal(
  client: Pick<ZeropsApiClient, "revealProjectVariable" | "revealServiceVariable">,
): VaultReveal {
  return {
    reveal: async (scope, id) => {
      try {
        const value =
          scope.kind === "shared"
            ? await client.revealProjectVariable(id)
            : await client.revealServiceVariable(id);
        return { ok: true, value };
      } catch (cause) {
        return { ok: false, code: cause instanceof ZeropsApiError ? cause.code : null };
      }
    },
  };
}
