/**
 * Moving a Mate into an application, out of one, or into a new one: only the applications and
 * roles HQ's rule lets this person place it as are drawn (`moveChoices`). Its copy says "project"
 * for an application, as the menus that open it do; the Mate is named, its Zerops project never.
 */
import type { ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Radio, RadioGroup } from "../ui/radio-group";
import { cn } from "~/lib/utils";
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

      <DialogPanel className="flex flex-col gap-5 space-y-0">
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
          <span className="text-sm">Project</span>
          <RadioGroup
            aria-label="Project"
            className="gap-2"
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
              <Choice key={group.id} selected={target === group.id} value={group.id}>
                {group.name}
              </Choice>
            ))}
            {choices.newApp.length > 0 ? (
              <Choice selected={target === "new"} value="new">
                New project
              </Choice>
            ) : null}
            {choices.none ? (
              <Choice selected={target === "none"} value="none">
                No project
              </Choice>
            ) : null}
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
                <FieldError>{errors.newGroupName}</FieldError>
              ) : null}
            </div>
          ) : null}
        </div>

        {target === "none" ? null : (
          <div className="space-y-2">
            <span className="text-sm">Role</span>
            <RadioGroup
              aria-label="Role"
              className="flex-row flex-wrap gap-2"
              disabled={pending || reading || readError !== undefined}
              onValueChange={(value) => {
                setRole(value as ZeropsEnvironmentRole);
                setAcknowledged(false);
              }}
              value={role}
            >
              {moveRolesFor(choices, target).map((entry) => (
                <Choice compact key={entry} selected={role === entry} value={entry}>
                  {environmentRoleLabel(entry) ?? entry}
                </Choice>
              ))}
            </RadioGroup>
            {showErrors && errors.role !== undefined ? (
              <FieldError>{errors.role}</FieldError>
            ) : null}
          </div>
        )}
        {(choices.refused ?? [])
          .filter(
            (entry) =>
              entry.appId === target || !choices.apps.some((app) => app.id === entry.appId),
          )
          .map((entry) => (
            <p key={`${entry.appId}:${entry.role}`} className="text-sm">
              {entry.appName} · {environmentRoleLabel(entry.role)}:{" "}
              {hqRefusalWords({ code: "forbidden", reason: entry.reason })}
            </p>
          ))}
        <p className="text-sm">
          Move changes placement within this HQ and organization. Moving a container to another HQ
          or organization is not supported.
        </p>
        {membership !== undefined ? (
          <div className="space-y-2 text-sm" data-zerops-surface="move-review">
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
                  destination by the move operation. The destination environment needs its own setup
                  and access.
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={pending}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  I understand the role and access changes for {name}.
                </label>
              </>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Moves across HQs, organizations or physical environments are not supported. Move changes
          placement within this HQ; it cannot migrate files or credentials.
        </p>
        {error !== null ? <p role="alert">{error}</p> : null}
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

function Choice({
  value,
  selected,
  compact = false,
  children,
}: {
  readonly value: string;
  readonly selected: boolean;
  readonly compact?: boolean;
  readonly children: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[var(--zerops-card-radius)] border border-border/55 text-sm transition-colors",
        compact ? "px-3 py-2" : "px-3 py-2.5",
        selected ? "border-primary/40 bg-primary/5" : "hover:bg-accent/50",
      )}
    >
      <Radio value={value} />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}

function FieldError({ children }: { readonly children: string }) {
  return (
    <p className="text-xs text-[var(--zerops-status-failed-text)]" role="alert">
      {children}
    </p>
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
