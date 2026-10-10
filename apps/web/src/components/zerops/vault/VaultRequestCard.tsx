/**
 * The Mate asks for a value only the person has: its name, where it goes and why, a field that
 * writes straight to the vault — never to the chat — and "Not now". Given, it folds to one line.
 * An ask the engine keeps reads Save and Decline, and says what makes the value take effect.
 * The field is masked until the person shows it, and secret is the person's word (the agent's flag
 * only pre-selects it). The agent's reason reads as its words; who can read the value, and what
 * never goes in, is ours. Props only: the container reads the vault and submits the write.
 */
import type {
  VaultAskActivityPayload,
  VaultScopeRef,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import { CircleAlertIcon, EyeIcon, EyeOffIcon, LockKeyholeIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import { FlatCard } from "../primitives";
import type { VaultWriteOutcome } from "./VaultPanel";
import {
  type VaultAsk,
  type VaultAskSaid,
  type VaultAskState,
  vaultAskEngineFace,
  vaultAskFace,
  vaultAskLooksOwn,
  vaultAskReach,
  vaultAskWhere,
  vaultAskWrite,
} from "./vaultRequest.logic";

export interface VaultRequestCardProps {
  readonly ask: VaultAsk;
  /** The Mate's name: who asks, and who hears it. */
  readonly mateName: string;
  readonly state: VaultAskState;
  readonly said: VaultAskSaid | null;
  /** The engine's record of the ask, on a conversation it keeps; `null` elsewhere. */
  readonly engine?: VaultAskActivityPayload["state"] | null;
  /** What the person does for the value to take effect; `null` before the vault is read. */
  readonly pickUp?: string | null;
  /** Submits the write and says how it ended; the container records it for the Mate's next message. */
  readonly onPut: (scope: VaultScopeRef, write: VaultWrite) => Promise<VaultWriteOutcome>;
  readonly onNotNow: () => void;
}

const PASTE_LABEL = "Paste it here — it goes to the vault, not the chat";

export function VaultRequestCard(props: VaultRequestCardProps) {
  const { ask, mateName, state } = props;
  const engine = props.engine ?? null;
  const pickUp = props.pickUp ?? null;
  const face =
    engine === null
      ? vaultAskFace(state.kind, props.said)
      : vaultAskEngineFace(engine, state.kind, props.said);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const secretLabel = useId();
  const [chosenSecret, setSecret] = useState(ask.sensitive);

  if (face !== "reading" && face !== "unplaced" && face !== "open") {
    return (
      <FlatCard
        className="flex items-start gap-2 px-3.5 py-2 text-xs"
        data-vault-request={ask.key}
        data-vault-request-face={face}
      >
        <LockKeyholeIcon
          aria-hidden="true"
          className="mt-px size-3.5 shrink-0 text-muted-foreground"
        />
        <div className="grid min-w-0 gap-0.5">
          <span className="min-w-0 truncate text-muted-foreground">
            {face === "not-now" || face === "declined" || face === "closed" ? (
              <>
                {mateName} asked for <span className="font-mono text-foreground">{ask.key}</span> ·{" "}
                {face === "not-now"
                  ? "Not now"
                  : face === "declined"
                    ? "Declined"
                    : "No longer asked"}
              </>
            ) : (
              <>
                <span className="font-mono text-foreground">{ask.key}</span> is in the vault
                {face === "put" ? ` — ${mateName} hears it with your next message` : ""}
                {face === "saved" ? ` — ${mateName} has been told` : ""}
              </>
            )}
          </span>
          {face === "saved" && pickUp !== null ? (
            <span className="text-muted-foreground" data-vault-request-pickup>
              {pickUp}
            </span>
          ) : null}
        </div>
      </FlatCard>
    );
  }

  const open = state.kind === "open" ? state : null;
  // A held secret stays secret: the choice is not the person's to undo here.
  const heldSecret = open?.held?.sensitive === true;
  const secret = heldSecret || chosenSecret;
  const canPut = open !== null && value !== "" && !busy;
  const put = async () => {
    if (!canPut) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await props.onPut(open.ref, vaultAskWrite(ask, open.held, value, secret));
    setBusy(false);
    if (outcome.ok) setValue("");
    else setRefusal(outcome.message);
  };

  return (
    <FlatCard
      className="flex min-w-0 items-start gap-2.5 px-3.5 py-3"
      data-vault-request={ask.key}
      data-vault-request-face={face}
    >
      <LockKeyholeIcon
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <div className="grid min-w-0 flex-1 gap-2.5">
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm text-foreground">
            {mateName} needs <span className="font-mono font-medium">{ask.key}</span>
          </p>
          <p className="text-xs text-muted-foreground" data-vault-request-where>
            {vaultAskWhere(ask)}
          </p>
          {ask.reason === null ? null : (
            <p className="text-xs leading-4.5 text-muted-foreground" data-vault-request-reason>
              {mateName}: <q className="italic">{ask.reason}</q>
            </p>
          )}
          <p className="text-xs leading-4.5 text-muted-foreground" data-vault-request-reach>
            {vaultAskReach(ask, mateName)}
          </p>
          {vaultAskLooksOwn(ask.key) ? (
            <p
              className="flex items-center gap-1.5 text-xs leading-4 text-destructive-foreground"
              data-vault-request-own
            >
              <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {ask.key} looks like a Zerops sign-in. {mateName} never needs yours.
            </p>
          ) : null}
          {engine === null || pickUp === null ? null : (
            <p className="text-xs leading-4.5 text-muted-foreground" data-vault-request-pickup>
              {pickUp}
            </p>
          )}
        </div>
        {face === "unplaced" ? (
          <p className="text-xs text-muted-foreground" data-vault-request-unplaced>
            {ask.scope.kind === "service" ? ask.scope.hostname : "This vault"} is not in this
            project any more.
          </p>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1">
              <Input
                aria-label={PASTE_LABEL}
                autoComplete="new-password"
                data-1p-ignore=""
                data-bwignore=""
                data-form-type="other"
                data-lpignore="true"
                disabled={open === null || busy}
                onChange={(event) => setValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void put();
                }}
                placeholder={PASTE_LABEL}
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
                size="icon-sm"
                variant="ghost-muted"
              >
                {shown ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
            </div>
            {refusal === null ? null : (
              <p
                className="flex items-center gap-1.5 text-xs leading-4 text-destructive-foreground"
                data-vault-request-refusal
                role="alert"
              >
                <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {refusal}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                aria-labelledby={secretLabel}
                checked={secret}
                disabled={heldSecret || open === null || busy}
                onCheckedChange={(checked) => setSecret(checked === true)}
              />
              <span id={secretLabel}>
                Keep it secret{heldSecret ? ": it is a secret already" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button disabled={!canPut} onClick={() => void put()} size="xs">
                {busy ? <Spinner size="xs" /> : null}
                {engine === null ? "Put in vault" : "Save"}
              </Button>
              <Button disabled={busy} onClick={props.onNotNow} size="xs" variant="ghost-muted">
                {engine === null ? "Not now" : "Decline"}
              </Button>
            </div>
          </>
        )}
      </div>
    </FlatCard>
  );
}
