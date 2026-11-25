/**
 * Moving a Mate into an application, out of one, or into a new one: only the applications and
 * roles HQ's rule lets this person place it as are drawn (`moveChoices`). Its copy says "project"
 * for an application, as the menus that open it do; the Mate is named, its Zerops project never.
 */
import type { ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { FieldError } from "../ui/field";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioCard, RadioGroup } from "../ui/radio-group";
import { environmentRoleLabel } from "./ZeropsGroupTree.logic";
import {
  initialMoveForm,
  moveRolesFor,
  resolveMoveMembership,
  roleWithin,
  validateMoveForm,
  type MoveChoices,
  type MoveMembership,
} from "./ZeropsMoveToGroupDialog.logic";

export function ZeropsMoveToGroupForm({
  name,
  choices,
  currentGroupId,
  currentRole,
  onCancel,
  onSubmit,
  pending = false,
  error = null,
  reading = false,
  readError,
  onReadAgain,
}: {
  /** The Mate's name, as its row in the left menu draws it. */
  readonly name: string;
  readonly choices: MoveChoices;
  readonly currentGroupId: string | undefined;
  readonly currentRole: ZeropsEnvironmentRole | undefined;
  readonly onCancel: () => void;
  readonly onSubmit: (membership: MoveMembership) => void;
  readonly pending?: boolean | undefined;
  readonly error?: string | null | undefined;
  readonly reading?: boolean | undefined;
  readonly readError?: string | undefined;
  readonly onReadAgain?: (() => void) | undefined;
}) {
  const id = useId();
  const [opened] = useState(() =>
    initialMoveForm(choices, { groupId: currentGroupId, role: currentRole }),
  );
  const [target, setTarget] = useState<string>(opened.target);
  const [newGroupName, setNewGroupName] = useState("");
  const [role, setRole] = useState<ZeropsEnvironmentRole | "">(opened.role);
  const [submitted, setSubmitted] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const form = { target, newGroupName, role };
  const errors = validateMoveForm(form);
  const showErrors = submitted;
  const membership = resolveMoveMembership(form, choices);
  const changesRole =
    membership !== undefined &&
    membership.kind !== "none" &&
    membership.role !== (currentRole ?? "dev");
  const destination =
    target === "new" ? newGroupName.trim() : choices.apps.find((app) => app.id === target)?.name;
  const canSubmit =
    !pending &&
    !reading &&
    readError === undefined &&
    membership !== undefined &&
    (!changesRole || acknowledged);

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="move-to-group-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (canSubmit && membership !== undefined) onSubmit(membership);
      }}
    >
      <DialogHeader>
        <DialogTitle>Move {name}</DialogTitle>
      </DialogHeader>

      <DialogPanel>
        <div className="flex flex-col gap-5">
          {reading ? <p role="status">Reading destinations from HQ…</p> : null}
          {readError !== undefined ? (
            <div>
              <p role="alert">{readError}</p>
              {onReadAgain !== undefined ? (
                <Button onClick={onReadAgain} type="button" variant="secondary">
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <span className="text-body">Project</span>
            <RadioGroup
              aria-label="Project"
              disabled={pending || reading || readError !== undefined}
              onValueChange={(value) => {
                const next = String(value);
                setTarget(next);
                setRole(roleWithin(choices, next, role));
                setAcknowledged(false);
              }}
              value={target}
            >
              {choices.apps.map((group) => (
                <RadioCard key={group.id} title={group.name} value={group.id} />
              ))}
              {choices.newApp.length > 0 ? <RadioCard title="New project" value="new" /> : null}
              {choices.none ? <RadioCard title="No project" value="none" /> : null}
            </RadioGroup>
            {target === "new" ? (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor={`${id}-group`}>Project name</Label>
                <Input
                  aria-invalid={showErrors && errors.newGroupName !== undefined ? true : undefined}
                  autoFocus
                  id={`${id}-group`}
                  onChange={(event) => {
                    setNewGroupName(event.target.value);
                    setAcknowledged(false);
                  }}
                  value={newGroupName}
                  disabled={pending}
                />
                {showErrors && errors.newGroupName !== undefined ? (
                  <FieldError match role="alert">
                    {errors.newGroupName}
                  </FieldError>
                ) : null}
              </div>
            ) : null}
          </div>

          {target === "none" ? null : (
            <div className="space-y-2">
              <span className="text-body">Role</span>
              <RadioGroup
                aria-label="Role"
                layout="row"
                disabled={pending || reading || readError !== undefined}
                onValueChange={(value) => {
                  setRole(value as ZeropsEnvironmentRole);
                  setAcknowledged(false);
                }}
                value={role}
              >
                {moveRolesFor(choices, target).map((entry) => (
                  <RadioCard
                    align="center"
                    key={entry}
                    title={environmentRoleLabel(entry) ?? entry}
                    value={entry}
                  />
                ))}
              </RadioGroup>
              {showErrors && errors.role !== undefined ? (
                <FieldError match role="alert">
                  {errors.role}
                </FieldError>
              ) : null}
            </div>
          )}
          {(choices.refused ?? [])
            .filter(
              (entry) =>
                entry.appId === target || !choices.apps.some((app) => app.id === entry.appId),
            )
            .map((entry) => (
              <p key={`${entry.appId}:${entry.role}`} className="text-body">
                {entry.appName} · {environmentRoleLabel(entry.role)}:{" "}
                {hqRefusalWords({ code: "forbidden", reason: entry.reason })}
              </p>
            ))}
          <p className="text-body">
            Move changes placement within this HQ and organization. Moving a container to another HQ
            or organization is not supported.
          </p>
          {membership !== undefined ? (
            <div className="space-y-2 text-body" data-zerops-surface="move-review">
              <p>
                {target === "none"
                  ? `${name} leaves its project and remains available as an ungrouped Mate.`
                  : `${name} becomes ${environmentRoleLabel(role || undefined) ?? role} in ${destination}.`}
              </p>
              <p>
                Its container stays in place. Its conversations and change history stay with {name}.
                Open changes stay with their repository.
              </p>
              {changesRole ? (
                <>
                  <p>
                    Source-project credentials, keys and jobs must be revoked and re-issued for the
                    destination by the move operation. The destination environment needs its own
                    setup and access.
                  </p>
                  <label className="flex items-start gap-2">
                    <Checkbox
                      checked={acknowledged}
                      disabled={pending}
                      onCheckedChange={(checked) => setAcknowledged(checked)}
                    />
                    I understand the role and access changes for {name}.
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
          <p className="text-body text-muted-foreground">
            Moves across HQs, organizations or physical environments are not supported. Move changes
            placement within this HQ; it cannot migrate files or credentials.
          </p>
          {error !== null ? <p role="alert">{error}</p> : null}
        </div>
      </DialogPanel>

      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button aria-busy={pending || undefined} disabled={!canSubmit} type="submit">
          {pending ? "Moving…" : target === "none" ? "Leave the project" : "Move"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ZeropsMoveToGroupDialog({
  open,
  onOpenChange,
  ...form
}: Parameters<typeof ZeropsMoveToGroupForm>[0] & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <ZeropsMoveToGroupForm {...form} />
      </DialogPopup>
    </Dialog>
  );
}
