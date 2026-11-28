/**
 * The message box's key: a value for the vault, given where the person would otherwise paste it
 * into a message. It opens the Vault's add card over the box, the Mate's own vault first, every app
 * and each app one choice away. The value goes from the card to the vault write as the person and
 * nowhere else; the message gets the key's `$NAME` at the caret, drawn as the key, and the Mate
 * hears where it is with it (`recordVaultWrite`), never the value. Only in a Mate's conversation:
 * elsewhere there is no vault to give to.
 */
import type { VaultScope, VaultView, VaultWrite } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { KeyRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { toastManager } from "~/lib/toasts";
import { recordVaultWrite } from "~/zerops/vaultTurnNotes";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { Button } from "../../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { Spinner } from "../../ui/spinner";
import { Text } from "../../ui/text";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { VaultAddCard } from "./VaultEditors";
import { useProjectVault, useVaultWriter } from "./VaultPanelContainer";
import { refusalWords, vaultName } from "./vault.logic";

/** The keys of a Mate's vault, each with the vault it is in: what the composer draws as keys. */
export function useComposerVaultKeys(environmentId: EnvironmentId): ReadonlyMap<string, string> {
  const mate = useKnownMate(environmentId);
  const project = useZeropsEnvironmentProject(environmentId);
  const view = useProjectVault(mate === undefined ? null : (project?.projectId ?? null));
  return useMemo(() => vaultKeys(view, mate?.name ?? null), [mate?.name, view]);
}

function vaultKeys(view: VaultView, mateName: string | null): ReadonlyMap<string, string> {
  return new Map(
    view.scopes.flatMap((scope) =>
      scope.values.map((value) => [value.key, vaultName(scope, mateName)] as const),
    ),
  );
}

export function ComposerVaultAddButton({
  environmentId,
  onAdded,
}: {
  readonly environmentId: EnvironmentId;
  /** The key is in the vault: its `$NAME` goes into the message; false where it could not. */
  readonly onAdded: (key: string) => boolean;
}) {
  const mate = useKnownMate(environmentId);
  const project = useZeropsEnvironmentProject(environmentId);
  const [open, setOpen] = useState(false);
  if (mate === undefined || project === undefined) return null;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label="Add a value to the vault"
                  data-chat-composer-vault=""
                  // The caret stays where it was in the text.
                  onPointerDown={(event) => event.preventDefault()}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                />
              }
            />
          }
        >
          <KeyRoundIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipPopup side="top">Add a value to the vault</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" padding="none" side="top" sideOffset={8} width="lg">
        <ComposerVaultAdd
          mateName={mate.name}
          onAdded={(key) => {
            setOpen(false);
            return onAdded(key);
          }}
          onCancel={() => setOpen(false)}
          project={project}
        />
      </PopoverPopup>
    </Popover>
  );
}

/** The add card, its vault read while the popup is open. */
function ComposerVaultAdd({
  project,
  mateName,
  onAdded,
  onCancel,
}: {
  readonly project: { readonly orgId: string; readonly projectId: string };
  readonly mateName: string;
  readonly onAdded: (key: string) => boolean;
  readonly onCancel: () => void;
}) {
  const view = useProjectVault(project.projectId);
  const { write } = useVaultWriter(project, view);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The Mate's own vault first: where a value given in its conversation is most often for.
  const scopes = useMemo(() => {
    const writable = view.scopes.filter((scope) => scope.editable);
    return [
      ...writable.filter((scope) => scope.kind === "mate"),
      ...writable.filter((scope) => scope.kind !== "mate"),
    ];
  }, [view.scopes]);

  const add = async (scope: VaultScope, change: Extract<VaultWrite, { kind: "add" }>) => {
    setBusy(true);
    setRefusal(null);
    const { outcome, change: written } = await write(scope.ref, change);
    setBusy(false);
    if (!outcome.ok || written === null) {
      setRefusal(
        outcome.ok
          ? "Zerops did not take it."
          : refusalWords(outcome.code, scope, change.key, outcome.message, mateName),
      );
      return;
    }
    recordVaultWrite(project.projectId, written);
    // The key in the message says it all; only where the message took none is it said here.
    if (!onAdded(change.key)) {
      toastManager.add({
        type: "success",
        title: `${change.key} is in ${vaultName(scope, mateName)}`,
        description: `${mateName} hears its name with your next message, never its value.`,
      });
    }
  };

  if (scopes.length === 0) {
    return (
      <Text className="flex items-center gap-2 px-4 py-3" role="status" variant="remark">
        {view.status === "unread" ? (
          <>
            <Spinner aria-hidden="true" size="xs" tone="muted" />
            Reading the vault…
          </>
        ) : (
          "The vault couldn't be read."
        )}
      </Text>
    );
  }
  return (
    <VaultAddCard
      busy={busy}
      forMessage
      framed={false}
      mateName={mateName}
      onAdd={(scope, change) => void add(scope, change)}
      onCancel={onCancel}
      refusal={refusal}
      scopes={scopes}
    />
  );
}
