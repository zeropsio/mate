/**
 * Moving a Mate into an application, out of one, or into a new one: only the applications and
 * roles HQ's rule lets this person place it as are drawn (`moveChoices`). Its copy says "project"
 * for an application, as the menus that open it do; the Mate is named, its Zerops project never.
 */
import type { ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";
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
}: {
  /** The Mate's name, as its row in the left menu draws it. */
  readonly name: string;
  readonly choices: MoveChoices;
  readonly currentGroupId: string | undefined;
  readonly currentRole: ZeropsEnvironmentRole | undefined;
  readonly onCancel: () => void;
  readonly onSubmit: (membership: MoveMembership) => void;
}) {
  const id = useId();
  const [opened] = useState(() =>
    initialMoveForm(choices, { groupId: currentGroupId, role: currentRole }),
  );
  const [target, setTarget] = useState<string>(opened.target);
  const [newGroupName, setNewGroupName] = useState("");
  const [role, setRole] = useState<ZeropsEnvironmentRole | "">(opened.role);
  const [submitted, setSubmitted] = useState(false);
  const form = { target, newGroupName, role };
  const errors = validateMoveForm(form);
  const showErrors = submitted;

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="move-to-group-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        const membership = resolveMoveMembership(form);
        if (membership !== undefined) onSubmit(membership);
      }}
    >
      <DialogHeader>
        <DialogTitle>Move {name}</DialogTitle>
      </DialogHeader>

      <DialogPanel className="flex flex-col gap-5 space-y-0">
        <div className="space-y-2">
          <span className="text-sm">Project</span>
          <RadioGroup
            aria-label="Project"
            className="gap-2"
            onValueChange={(value) => {
              const next = String(value);
              setTarget(next);
              setRole(roleWithin(choices, next, role));
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
                }}
                value={newGroupName}
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
              onValueChange={(value) => {
                setRole(value as ZeropsEnvironmentRole);
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
      </DialogPanel>

      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button type="submit">{target === "none" ? "Leave the project" : "Move"}</Button>
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
