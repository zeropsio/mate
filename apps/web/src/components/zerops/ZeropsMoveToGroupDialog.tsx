/**
 * Moving a project into a group, out of one, or into a new one.
 */
import type { ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
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
  resolveMoveMembership,
  validateMoveForm,
  type MoveGroupChoice,
  type MoveMembership,
} from "./ZeropsMoveToGroupDialog.logic";

const ROLES: ReadonlyArray<ZeropsEnvironmentRole> = ["dev", "stage", "prod"];

export function ZeropsMoveToGroupForm({
  projectName,
  groups,
  currentGroupId,
  currentRole,
  mintGroupId,
  onCancel,
  onSubmit,
}: {
  readonly projectName: string;
  readonly groups: ReadonlyArray<MoveGroupChoice>;
  readonly currentGroupId: string | undefined;
  readonly currentRole: ZeropsEnvironmentRole | undefined;
  readonly mintGroupId: () => string;
  readonly onCancel: () => void;
  readonly onSubmit: (membership: MoveMembership) => void;
}) {
  const id = useId();
  const [target, setTarget] = useState<string>(currentGroupId ?? groups[0]?.id ?? "new");
  const [newGroupName, setNewGroupName] = useState("");
  const [role, setRole] = useState<ZeropsEnvironmentRole | "">(currentRole ?? "dev");
  const [submitted, setSubmitted] = useState(false);
  const form = { target, newGroupName, role };
  const errors = validateMoveForm(form);
  const showErrors = submitted;

  return (
    <form
      className="flex flex-col gap-5"
      data-zerops-surface="move-to-group-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        const membership = resolveMoveMembership(form, mintGroupId);
        if (membership !== undefined) onSubmit(membership);
      }}
    >
      <DialogHeader className="px-0 pt-0">
        <DialogTitle>Move {projectName}</DialogTitle>
        <DialogDescription>
          A group is what you call the application; its environments are the projects in it.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <span className="text-sm">Group</span>
        <RadioGroup
          aria-label="Group"
          className="gap-2"
          onValueChange={(value) => {
            setTarget(String(value));
          }}
          value={target}
        >
          {groups.map((group) => (
            <Choice key={group.id} selected={target === group.id} value={group.id}>
              {group.name}
            </Choice>
          ))}
          <Choice selected={target === "new"} value="new">
            New group
          </Choice>
          <Choice selected={target === "none"} value="none">
            No group
          </Choice>
        </RadioGroup>
        {target === "new" ? (
          <div className="space-y-1.5 pt-1">
            <Label htmlFor={`${id}-group`}>Group name</Label>
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
            {ROLES.map((entry) => (
              <Choice compact key={entry} selected={role === entry} value={entry}>
                {environmentRoleLabel(entry) ?? entry}
              </Choice>
            ))}
          </RadioGroup>
          {showErrors && errors.role !== undefined ? <FieldError>{errors.role}</FieldError> : null}
        </div>
      )}

      <DialogFooter className="px-0 pb-0">
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button type="submit">{target === "none" ? "Leave the group" : "Move"}</Button>
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
        <DialogPanel>
          <ZeropsMoveToGroupForm {...form} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
