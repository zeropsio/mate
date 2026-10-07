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
  pending = false,
  readOnly = false,
  error: refusal = null,
  onCancel,
  onSubmit,
}: {
  readonly title: string;
  readonly description?: string;
  readonly label: string;
  readonly initialValue: string;
  readonly submitLabel: string;
  readonly validate: (value: string) => string | undefined;
  /** The press is in flight: the form waits for its answer and takes no second press. */
  readonly pending?: boolean;
  /** The name is not the person's to change now. */
  readonly readOnly?: boolean;
  /** Why the last press was refused, said in the dialog that made it. */
  readonly error?: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const [submitted, setSubmitted] = useState(false);
  const error = validate(value);

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        setSubmitted(true);
        if (error !== undefined) return;
        onSubmit(value.replace(/\s+/g, " ").trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-value`}>{label}</Label>
          <Input
            aria-invalid={submitted && error !== undefined ? true : undefined}
            autoFocus
            id={`${id}-value`}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            readOnly={readOnly}
            value={value}
          />
          {submitted && error !== undefined ? (
            <p className="text-xs text-[var(--zerops-status-failed-text)]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter>
        <p
          className="me-auto min-h-4 self-center text-line leading-4 text-status-failed-text"
          role="alert"
        >
          {refusal}
        </p>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button aria-busy={pending || undefined} disabled={pending} type="submit">
          {submitLabel}
        </Button>
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
        <ZeropsRenameForm {...form} />
      </DialogPopup>
    </Dialog>
  );
}
