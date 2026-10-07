/**
 * The Mate asks for a value only the person has: its name, where it goes and why, a field that
 * writes straight to the vault — never to the chat — and "Not now". Given, it folds to one line.
 * Props only: the container reads the vault and submits the write.
 */
import type { VaultScopeRef, VaultWrite } from "@t3tools/client-runtime/data";
import { CircleAlertIcon, LockKeyholeIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import { FlatCard } from "../primitives";
import type { VaultWriteOutcome } from "./VaultPanel";
import {
  type VaultAsk,
  type VaultAskSaid,
  type VaultAskState,
  vaultAskFace,
  vaultAskWhere,
  vaultAskWrite,
} from "./vaultRequest.logic";

export interface VaultRequestCardProps {
  readonly ask: VaultAsk;
  /** The Mate's name: who asks, and who hears it. */
  readonly mateName: string;
  readonly state: VaultAskState;
  readonly said: VaultAskSaid | null;
  /** Submits the write and says how it ended; the container records it for the Mate's next message. */
  readonly onPut: (scope: VaultScopeRef, write: VaultWrite) => Promise<VaultWriteOutcome>;
  readonly onNotNow: () => void;
}

const PASTE_LABEL = "Paste it here — it goes to the vault, not the chat";

export function VaultRequestCard(props: VaultRequestCardProps) {
  const { ask, mateName, state } = props;
  const face = vaultAskFace(state.kind, props.said);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (face === "put" || face === "filled" || face === "not-now") {
    return (
      <FlatCard
        className="flex items-center gap-2 px-3.5 py-2 text-xs"
        data-vault-request={ask.key}
        data-vault-request-face={face}
      >
        <LockKeyholeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-muted-foreground">
          {face === "not-now" ? (
            <>
              {mateName} asked for <span className="font-mono text-foreground">{ask.key}</span> ·
              Not now
            </>
          ) : (
            <>
              <span className="font-mono text-foreground">{ask.key}</span> is in the vault
              {face === "put" ? ` — ${mateName} hears it with your next message` : ""}
            </>
          )}
        </span>
      </FlatCard>
    );
  }

  const open = state.kind === "open" ? state : null;
  const canPut = open !== null && value !== "" && !busy;
  const put = async () => {
    if (!canPut) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await props.onPut(open.ref, vaultAskWrite(ask, open.held, value));
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
              {ask.reason}
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
            <Input
              aria-label={PASTE_LABEL}
              autoComplete="off"
              disabled={open === null || busy}
              onChange={(event) => setValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void put();
              }}
              placeholder={PASTE_LABEL}
              size="sm"
              spellCheck={false}
              type={ask.sensitive ? "password" : "text"}
              value={value}
            />
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
            <div className="flex items-center gap-2">
              <Button disabled={!canPut} onClick={() => void put()} size="xs">
                {busy ? <Spinner size="xs" /> : null}
                Put in vault
              </Button>
              <Button disabled={busy} onClick={props.onNotNow} size="xs" variant="ghost-muted">
                Not now
              </Button>
            </div>
          </>
        )}
      </div>
    </FlatCard>
  );
}
