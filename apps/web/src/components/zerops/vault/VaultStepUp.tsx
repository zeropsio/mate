/**
 * Zerops shows a secret only in sudo mode. A personal token from the hand-over is always in it; a
 * session from Zerops HQ is not until the person confirms it's them, and its sudo lasts about two
 * hours. This is that confirmation, offered where a reveal was refused for it: on the click, HQ's
 * sudo prompt (`zeropsHq.ts`); once the session is in sudo, the reveal runs again.
 */
import { useState } from "react";

import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { Button } from "../../ui/button";

type StepUpState =
  | { readonly kind: "idle" }
  | { readonly kind: "asking" }
  | { readonly kind: "failed"; readonly message: string };

export function VaultStepUp({ onConfirmed }: { readonly onConfirmed: () => void }) {
  const prompts = useZeropsSessionOptional()?.zeropsHq ?? null;
  const [state, setState] = useState<StepUpState>({ kind: "idle" });
  if (prompts === null) return null;

  // Runs on the click: where HQ's bridge refuses this origin, its device login opens a window.
  const confirm = () => {
    setState({ kind: "asking" });
    prompts.sudo().then(
      (answer) => {
        setState({ kind: "idle" });
        if (answer === "confirmed") onConfirmed();
      },
      (cause: unknown) => {
        setState({
          kind: "failed",
          message: cause instanceof Error ? cause.message : "Zerops didn't confirm it.",
        });
      },
    );
  };

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-vault-step-up="ask">
      <Button disabled={state.kind === "asking"} onClick={confirm} size="sm" variant="secondary">
        Confirm in Zerops
      </Button>
      {state.kind === "failed" ? (
        <span className="text-destructive-foreground" role="alert">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
