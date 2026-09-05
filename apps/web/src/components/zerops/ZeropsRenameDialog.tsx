/**
 * One field, one verb. Used to rename an agent and to rename a group; the
 * caller says what is being renamed and what a good name is.
 */
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

export function ZeropsRenameForm({
  title,
  description,
  label,
  initialValue,
  submitLabel,
  validate,
  onCancel,
  onSubmit,
}: {
  readonly title: string;
  readonly description?: string;
  readonly label: string;
  readonly initialValue: string;
  readonly submitLabel: string;
  readonly validate: (value: string) => string | undefined;
  readonly onCancel: () => void;
  readonly onSubmit: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const [submitted, setSubmitted] = useState(false);
  const error = validate(value);

  return (
    <form
      className="flex flex-col gap-5"
      data-zerops-surface="rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (error !== undefined) return;
        onSubmit(value.replace(/\s+/g, " ").trim());
      }}
    >
      <DialogHeader className="px-0 pt-0">
        <DialogTitle>{title}</DialogTitle>
        {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-value`}>{label}</Label>
        <Input
          aria-invalid={submitted && error !== undefined ? true : undefined}
          autoFocus
          id={`${id}-value`}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          value={value}
        />
        {submitted && error !== undefined ? (
          <p className="text-xs text-[var(--zerops-status-failed-text)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="px-0 pb-0">
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button type="submit">{submitLabel}</Button>
      </DialogFooter>
    </form>
  );
}

export function ZeropsRenameDialog({
  open,
  onOpenChange,
  ...form
}: Parameters<typeof ZeropsRenameForm>[0] & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <DialogPanel>
          <ZeropsRenameForm {...form} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
