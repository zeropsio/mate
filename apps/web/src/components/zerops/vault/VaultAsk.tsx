/**
 * The Mate asks for a value only the person has, on the ask card: where it goes, the Mate's why,
 * a masked field with "Keep hidden", Save to vault and Not now. The same ask in both its homes —
 * `full` in the conversation where it was asked, `compact` above the composer while the Mate is
 * stopped on it. The value goes from the field to the vault write as the person and nowhere else.
 * Props only: the container reads the engine's record and the vault, and writes and answers.
 */
import type { VaultScopeRef, VaultWrite } from "@t3tools/client-runtime/data";
import { CircleAlertIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { NOT_NOW } from "../../ask/ask.logic";
import { AskCard, AskFooter, type AskDensity } from "../../ask/AskCard";
import { AskSecretField } from "../../ask/AskSecret";
import { Button } from "../../ui/button";
import {
  type VaultAsk,
  type VaultAskState,
  type VaultAskView,
  vaultAskLabel,
  vaultAskWrite,
} from "./vaultRequest.logic";

export interface VaultAskProps {
  /** The engine's request: the ask's identity in both homes. */
  readonly askId: string;
  readonly ask: VaultAsk;
  readonly mateName: string;
  readonly density: AskDensity;
  /** Where the value goes, read off the vault: the write is built from it. */
  readonly vault: VaultAskState;
  readonly view: VaultAskView;
  /** Compact: the asking Mate's face. */
  readonly face?: ReactNode;
  /** Writes the value as the person; says whether it went in. */
  readonly onSave: (scope: VaultScopeRef, write: VaultWrite) => Promise<boolean>;
  /** The value given in the Vault since it was asked is the answer. */
  readonly onUseGiven: () => void;
  readonly onNotNow: () => void;
  readonly onShowInConversation?: (() => void) | undefined;
}

export function VaultAsk(props: VaultAskProps) {
  const { ask, view, density, vault } = props;
  const [value, setValue] = useState("");
  const [keepHidden, setKeepHidden] = useState(true);
  const open = vault.kind === "open" ? vault : null;
  // A value the vault already keeps hidden stays hidden.
  const hiddenAlready = open?.held?.sensitive === true;
  const working = view.state.kind === "working";
  const field = view.body.kind === "field" ? view.body : null;

  const save = async () => {
    if (open === null || value === "" || working) return;
    const write = vaultAskWrite(ask, open.held, value, hiddenAlready || keepHidden);
    if (await props.onSave(open.ref, write)) setValue("");
  };
  const press = () => (view.main?.does === "useGiven" ? props.onUseGiven() : void save());
  const canPress = view.main?.does === "useGiven" || (field?.ready === true && value !== "");
  const size = density === "compact" ? "sm" : "md";
  const note = field === null ? undefined : "Goes to the vault, not the chat";
  const warning =
    view.warning === null || field === null ? null : (
      <p
        className="flex items-center gap-1.5 text-caption text-destructive-foreground"
        data-vault-ask-warning
      >
        <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {view.warning}
      </p>
    );
  const body =
    field !== null ? (
      <>
        <AskSecretField
          density={density}
          disabled={!field.ready || working}
          hiddenAlready={hiddenAlready}
          keepHidden={keepHidden}
          label={vaultAskLabel(ask)}
          onEnter={() => void save()}
          onKeepHidden={setKeepHidden}
          onValue={setValue}
          value={value}
        />
        {warning}
      </>
    ) : view.body.kind === "given" ? (
      <p className="text-body text-muted-foreground" data-vault-ask-given>
        {view.body.words}
      </p>
    ) : undefined;

  return (
    <AskCard
      askId={props.askId}
      density={density}
      face={props.face}
      footer={
        <AskFooter
          action={
            view.state.kind !== "failed" ? undefined : view.main === null ? (
              <Button onClick={props.onNotNow} size={size} variant="ghost">
                {NOT_NOW}
              </Button>
            ) : (
              <Button disabled={!canPress} onClick={press} size={size} variant="secondary">
                Try again
              </Button>
            )
          }
          density={density}
          main={
            view.main === null
              ? null
              : { label: view.main.label, onPress: press, disabled: !canPress }
          }
          note={note}
          onNotNow={props.onNotNow}
          state={view.state}
        />
      }
      kind="vault"
      note={note}
      onShowInConversation={props.onShowInConversation}
      state={view.state.kind}
      title={view.title}
      where={view.where}
      why={view.why === null ? null : { who: props.mateName, words: view.why }}
    >
      {body}
    </AskCard>
  );
}
