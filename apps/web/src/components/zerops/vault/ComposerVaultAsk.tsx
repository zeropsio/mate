/**
 * The Mate asks for a value only the person has, at the composer's top where its questions and
 * approvals wait, in their one look: its face, one line of what it needs and why, one plain sentence
 * of what happens, Not now and Save to vault, and under them a masked field with its eye and "Keep
 * hidden". The value goes from the field to the vault write and nowhere else. Props only: the
 * container reads the vault and answers.
 */
import type { VaultScopeRef, VaultWrite } from "@t3tools/client-runtime/data";
import { CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { ComposerAsk, ComposerAskMark } from "../../chat/ComposerAsk";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import { Switch } from "../../ui/switch";
import type { VaultWriteOutcome } from "./VaultPanel";
import {
  type VaultAsk,
  type VaultAskState,
  vaultAskLabel,
  vaultAskLine,
  vaultAskNote,
  vaultAskWarning,
  vaultAskWrite,
} from "./vaultRequest.logic";

export interface ComposerVaultAskProps {
  readonly ask: VaultAsk;
  readonly mateName: string;
  /** The asking Mate's face (`ComposerAskFace`); a plain agent's mark without one. */
  readonly face?: ReactNode;
  readonly state: VaultAskState;
  /** Writes the value and answers saved; says how it ended. */
  readonly onSave: (scope: VaultScopeRef, write: VaultWrite) => Promise<VaultWriteOutcome>;
  /** The value the person added in the Vault meanwhile is the answer. */
  readonly onUseGiven: () => void;
  readonly onNotNow: () => void;
}

export function ComposerVaultAsk(props: ComposerVaultAskProps) {
  const { ask, mateName, state } = props;
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [hiddenChosen, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const hiddenLabel = useId();

  const open = state.kind === "open" ? state : null;
  // A value the vault already keeps hidden stays hidden.
  const heldHidden = open?.held?.sensitive === true;
  const hidden = heldHidden || hiddenChosen;
  const canSave = open !== null && value !== "" && !busy;
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await props.onSave(open.ref, vaultAskWrite(ask, open.held, value, hidden));
    setBusy(false);
    if (outcome.ok) setValue("");
    else setRefusal(outcome.message ?? "Zerops did not take it.");
  };
  const warning = vaultAskWarning(ask, mateName);
  const takes = state.kind === "open" || state.kind === "reading";

  return (
    <div data-vault-ask={ask.key} data-vault-ask-state={state.kind}>
      <ComposerAsk
        actions={
          <>
            <Button
              disabled={busy}
              onClick={props.onNotNow}
              size="md"
              type="button"
              variant="ghost"
            >
              Not now
            </Button>
            {takes ? (
              <Button disabled={!canSave} onClick={() => void save()}>
                {busy ? <Spinner size="xs" /> : null}
                Save to vault
              </Button>
            ) : state.kind === "filled" ? (
              <Button onClick={props.onUseGiven}>Use that one</Button>
            ) : null}
          </>
        }
        detail={
          <>
            {refusal !== null ? (
              <p
                className="flex items-center gap-1.5 text-destructive-foreground"
                data-vault-ask-refusal
                role="alert"
              >
                <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {refusal}
              </p>
            ) : (
              <p data-vault-ask-note>{vaultAskNote(ask, state.kind, mateName)}</p>
            )}
            {warning === null ? null : (
              <p
                className="flex items-center gap-1.5 text-destructive-foreground"
                data-vault-ask-warning
              >
                <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {warning}
              </p>
            )}
          </>
        }
        face={props.face ?? <ComposerAskMark />}
        kind="vault"
        label={`${mateName} needs your ${vaultAskLabel(ask)}`}
        title={<span data-vault-ask-line>{vaultAskLine(ask, mateName)}</span>}
      >
        {takes ? (
          // The field keeps a width to type in; Keep hidden goes under it where both do not fit.
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex min-w-48 flex-1 items-center gap-1">
              <Input
                aria-label={`Your ${vaultAskLabel(ask)}`}
                autoComplete="new-password"
                data-1p-ignore=""
                data-bwignore=""
                data-form-type="other"
                data-lpignore="true"
                disabled={open === null || busy}
                onChange={(event) => setValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void save();
                  }
                }}
                placeholder={ask.key}
                size="sm"
                spellCheck={false}
                type={shown ? "text" : "password"}
                value={value}
              />
              <Button
                aria-label={shown ? "Hide" : "Show"}
                aria-pressed={shown}
                disabled={open === null}
                onClick={() => setShown((current) => !current)}
                size="icon-md"
                type="button"
                variant="ghost"
              >
                {shown ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
              <Switch
                aria-labelledby={hiddenLabel}
                checked={hidden}
                disabled={heldHidden || open === null || busy}
                onCheckedChange={(checked) => setHidden(checked)}
              />
              <span id={hiddenLabel}>Keep hidden</span>
            </div>
          </div>
        ) : undefined}
      </ComposerAsk>
    </div>
  );
}
