/**
 * The Vault's lines on top: one per thing that needs the person, each a sentence that says what
 * to do, and at most one action. Values its apps don't run yet (beside a Mate, the Mate restarts
 * them with the next message; without one, a restart per app, confirmed first); values not set,
 * opened where they take a paste; secrets anyone with access can read, hidden in one press.
 * No box: a line sits on the panel like the rows' headings do.
 */
import type { VaultWrite } from "@t3tools/client-runtime/data";
import { EyeOffIcon, KeyRoundIcon, RotateCwIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { RESTART_CONFIRM, type notLiveLine } from "./vault.logic";
import { unsetTitle, type VaultEntry, type vaultNeeds } from "./vaultGroups.logic";

export interface VaultLinesProps {
  readonly actor: "mate" | "environment";
  readonly notLive: ReturnType<typeof notLiveLine>;
  readonly needs: ReturnType<typeof vaultNeeds>;
  readonly restarting: ReadonlySet<string>;
  readonly busy: (entry: VaultEntry) => boolean;
  readonly onOpenNotLive: () => void;
  readonly onOpenUnset: (entry: VaultEntry) => void;
  readonly onRestart: (serviceId: string) => void;
  readonly onWrite: (entry: VaultEntry, change: VaultWrite) => Promise<boolean>;
}

export function VaultLines(props: VaultLinesProps) {
  const { notLive } = props;
  const { unset, readable } = props.needs;
  const [hiding, setHiding] = useState(false);
  if (notLive === null && unset.length === 0 && readable.length === 0) return null;

  const hideAll = async () => {
    setHiding(true);
    for (const entry of readable) {
      await props.onWrite(entry, {
        kind: "update",
        id: entry.value.id,
        key: entry.value.key,
        value: entry.value.value ?? "",
        sensitive: true,
      });
    }
    setHiding(false);
  };

  return (
    <div className="grid gap-1" data-vault-lines>
      {notLive === null ? null : (
        <div className="grid gap-1" data-vault-notlive>
          <Line
            icon={<RotateCwIcon aria-hidden="true" className="size-3.5 text-warning-foreground" />}
          >
            <button
              className="text-left outline-none hover:underline focus-visible:underline"
              data-vault-notlive-item={`restart:${notLive.restarts[0]?.serviceId ?? ""}`}
              onClick={props.onOpenNotLive}
              type="button"
            >
              {notLive.text}
            </button>
          </Line>
          {props.actor === "environment"
            ? notLive.restarts.map((item) => (
                <RestartLine
                  hostname={item.hostname}
                  key={item.serviceId}
                  onRestart={() => props.onRestart(item.serviceId)}
                  restarting={props.restarting.has(item.serviceId)}
                />
              ))
            : null}
        </div>
      )}
      {unset.length === 0 ? null : (
        <Line
          icon={<KeyRoundIcon aria-hidden="true" className="size-3.5 text-warning-foreground" />}
        >
          <button
            className="text-left outline-none hover:underline focus-visible:underline"
            data-vault-needs="unset"
            onClick={() => {
              const first = unset[0];
              if (first !== undefined) props.onOpenUnset(first);
            }}
            type="button"
          >
            {unsetTitle(unset)} — paste {unset.length === 1 ? "it" : "them"} in{" "}
            {unset.length === 1 ? "its row" : "their rows"}
          </button>
        </Line>
      )}
      {readable.length === 0 ? null : (
        <Line
          action={
            <Button
              disabled={hiding || readable.some(props.busy)}
              onClick={() => void hideAll()}
              size="sm"
              variant="outline"
            >
              {hiding ? <Spinner size="xs" /> : null}
              {readable.length === 1 ? "Hide it" : "Hide them"}
            </Button>
          }
          icon={<EyeOffIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />}
        >
          <span data-vault-needs="readable">
            {readable.length === 1
              ? "1 secret can be read by anyone with access"
              : `${readable.length} secrets can be read by anyone with access`}
          </span>
        </Line>
      )}
    </div>
  );
}

function Line(props: {
  readonly icon: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2.5 px-1 text-line text-foreground">
      <span className="grid size-4 shrink-0 place-items-center">{props.icon}</span>
      <span className="min-w-0 grow">{props.children}</span>
      {props.action}
    </div>
  );
}

/** Without a Mate: a restart per app, said out loud before it happens. */
function RestartLine(props: {
  readonly hostname: string;
  readonly restarting: boolean;
  readonly onRestart: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="grid gap-1.5 pl-7.5" data-vault-restart={props.hostname}>
      <div>
        <Button
          disabled={props.restarting || asking}
          onClick={() => setAsking(true)}
          size="sm"
          variant="outline"
        >
          {props.restarting ? <Spinner size="xs" /> : <RotateCwIcon />}
          {props.restarting ? `Restarting ${props.hostname}…` : `Restart ${props.hostname}`}
        </Button>
      </div>
      {asking ? (
        <div
          aria-label={`Restart ${props.hostname}`}
          className="flex flex-wrap items-center gap-2 text-xs text-foreground"
          role="alertdialog"
        >
          <span className="grow">{RESTART_CONFIRM(props.hostname)}</span>
          <Button
            onClick={() => {
              setAsking(false);
              props.onRestart();
            }}
            size="sm"
          >
            Restart
          </Button>
          <Button onClick={() => setAsking(false)} size="sm" variant="ghost-muted">
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
