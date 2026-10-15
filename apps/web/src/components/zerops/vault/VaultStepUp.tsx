/**
 * Zerops shows a secret only in sudo mode. A personal token from the hand-over is always in it; a
 * device-login session is not until the person confirms in the Zerops window, and its sudo lasts
 * about two hours. This is that confirmation, offered where a reveal was refused for it: on the
 * click, a sudo device login; once approved, the reveal runs again.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useRef, useState } from "react";

import {
  runZeropsDeviceLogin,
  type ZeropsDeviceLoginRun,
  type ZeropsDeviceLoginStage,
} from "~/zerops/deviceLogin";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { Button } from "../../ui/button";

type StepUpState =
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly stage: ZeropsDeviceLoginStage }
  | { readonly kind: "failed"; readonly message: string };

const linkClass = "underline underline-offset-2 hover:text-foreground";

export function VaultStepUp({ onConfirmed }: { readonly onConfirmed: () => void }) {
  const session = useZeropsSessionOptional();
  const [state, setState] = useState<StepUpState>({ kind: "idle" });
  const run = useRef<ZeropsDeviceLoginRun | null>(null);
  const generation = useRef(0);
  useEffect(() => () => run.current?.cancel(), []);
  if (session === null) return null;
  const { client, sudoBearer } = session;

  // Runs on the click: the Zerops window must open before anything is awaited.
  const confirm = () => {
    run.current?.cancel();
    const attempt = ++generation.current;
    const current = () => generation.current === attempt;
    run.current = runZeropsDeviceLogin({
      kind: "sudo",
      apiBase: client.baseUrl,
      bearer: sudoBearer,
      onStage: (stage) => {
        if (current()) setState({ kind: "waiting", stage });
      },
    });
    void run.current.outcome.then(
      (outcome) => {
        if (!current()) return;
        if (outcome.kind === "approved") {
          setState({ kind: "idle" });
          onConfirmed();
        } else if (outcome.kind === "cancelled") setState({ kind: "idle" });
        else
          setState({
            kind: "failed",
            message:
              outcome.kind === "denied"
                ? "Zerops didn't confirm it."
                : "The Zerops window timed out. Try again.",
          });
      },
      (cause: unknown) => {
        if (current()) setState({ kind: "failed", message: zeropsErrorMessage(cause) });
      },
    );
  };
  const cancel = () => {
    generation.current += 1;
    run.current?.cancel();
    setState({ kind: "idle" });
  };

  if (state.kind === "waiting") {
    const { stage } = state;
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1" data-vault-step-up="waiting">
        {stage.kind === "waiting" && stage.blocked ? (
          <a className={linkClass} href={stage.url} rel="noopener" target="_blank">
            Continue in Zerops
          </a>
        ) : (
          <>
            {stage.kind === "waiting" && stage.windowMayBeOlder ? (
              <span>
                The sign-in was renewed, so the code in the Zerops window may have changed; it is
                now <span className="font-mono">{stage.userCode}</span>.
              </span>
            ) : (
              <span>
                Finish in the Zerops window
                {stage.kind === "waiting" ? (
                  <>
                    , where it shows <span className="font-mono">{stage.userCode}</span>
                  </>
                ) : null}
                .
              </span>
            )}
            {stage.kind === "waiting" ? (
              <button className={linkClass} onClick={() => run.current?.reopen()} type="button">
                Reopen the Zerops window
              </button>
            ) : null}
          </>
        )}
        <button className={linkClass} onClick={cancel} type="button">
          Cancel sign-in
        </button>
      </p>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-vault-step-up="ask">
      <Button onClick={confirm} size="sm" variant="outline">
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
