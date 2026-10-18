/**
 * The card a connection's row unfolds to connect it (GitHub, Slack, Discord): numbered steps, each
 * a short title and one line of help; the keys it takes stacked full width, each with where to
 * find it; every address the other side must be given shown up front with its Copy; and at the
 * end one Connect, pressable once every key holds, beside a quiet Cancel.
 */
import { ArrowUpRightIcon } from "lucide-react";
import { useId, type FormEvent, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function ConnectCard({
  onSubmit,
  onCancel,
  submit,
  ready,
  busy,
  note,
  problem,
  children,
}: {
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  /** The press's words: *Connect*, or what it started while that is under way. */
  readonly submit: string;
  /** Every key typed and holding. */
  readonly ready: boolean;
  readonly busy: boolean;
  /** One quiet line beside the presses: what becomes of what is typed. */
  readonly note?: ReactNode;
  /** HQ's refusal of the press, said above it. */
  readonly problem?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <FlowSurface>
      <form
        className="grid gap-5"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (ready && !busy) onSubmit();
        }}
      >
        <ol className="grid gap-5">{children}</ol>
        {problem ? (
          <p className="text-xs text-destructive-foreground" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="flex items-center gap-2 border-t border-border/70 pt-4">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{note}</p>
          <Button onClick={onCancel} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button disabled={!ready || busy} size="sm" type="submit">
            {submit}
          </Button>
        </div>
      </form>
    </FlowSurface>
  );
}

/** The surface a row's press unfolds: edged in both themes, a step in from the row. */
export function FlowSurface({ children }: { readonly children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-muted/40 p-4">{children}</div>;
}

/** One step: its number, a short title, one line of help, and what it takes. */
export function ConnectStep({
  n,
  title,
  help,
  children,
}: {
  readonly n: number;
  readonly title: string;
  readonly help?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
      <span
        aria-hidden
        className="mt-px flex size-5 items-center justify-center rounded-full border border-border bg-background text-2xs font-medium text-muted-foreground tabular-nums"
      >
        {n}
      </span>
      <div className="grid min-w-0 gap-3">
        <div className="grid gap-0.5">
          <p className="text-sm font-medium text-foreground">
            <span className="sr-only">{`Step ${String(n)}: `}</span>
            {title}
          </p>
          {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

/** A key the step takes: its label, the field full width, and where to find it — or what is wrong. */
export function KeyField({
  label,
  hint,
  value,
  onChange,
  problem = null,
  secret = false,
  placeholder,
  maxLength,
  autoFocus = false,
}: {
  readonly label: string;
  /** Where the value is found on the other side. */
  readonly hint: ReactNode;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** What is wrong with it as typed: said in the hint's place. */
  readonly problem?: string | null;
  readonly secret?: boolean;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-describedby={`${id}-hint`}
        aria-invalid={problem === null ? undefined : true}
        autoComplete="off"
        autoFocus={autoFocus}
        id={id}
        maxLength={maxLength}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        size="sm"
        spellCheck={false}
        type={secret ? "password" : "text"}
        value={value}
      />
      {problem === null ? (
        <p className="text-xs text-muted-foreground" id={`${id}-hint`}>
          {hint}
        </p>
      ) : (
        <p className="text-xs text-destructive-foreground" id={`${id}-hint`} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** An address the other side must be given: its label, the address whole, Copy, and where it goes. */
export function AddressField({
  label,
  hint,
  value,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  /** The address; `null` while it is read: the room is held and Copy waits. */
  readonly value: string | null;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: label });
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex min-w-0 items-center gap-2">
        <code className="flex h-7.5 min-w-0 flex-1 items-center truncate rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground sm:h-6.5">
          {value}
        </code>
        <Button
          disabled={value === null}
          onClick={() => {
            if (value !== null) copyToClipboard(value, undefined);
          }}
          size="sm"
          variant="secondary"
        >
          <span className="grid">
            <span aria-hidden className="invisible col-start-1 row-start-1">
              Copied
            </span>
            <span className="col-start-1 row-start-1">{isCopied ? "Copied" : "Copy"}</span>
          </span>
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Where an address will show once HQ makes it: the field's room, saying when. */
export function PendingAddress({
  label,
  words,
  hint,
}: {
  readonly label: string;
  readonly words: string;
  readonly hint?: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="flex h-7.5 items-center rounded-md border border-dashed border-input px-2.5 text-xs text-muted-foreground sm:h-6.5">
        {words}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A press that leaves for another site in a new tab, its arrow saying so. */
export function OutButton({
  href,
  primary = false,
  children,
}: {
  readonly href: string;
  readonly primary?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Button
      render={<a href={href} rel="noreferrer" target="_blank" />}
      size="sm"
      variant={primary ? "primary" : "secondary"}
    >
      {children}
      <ArrowUpRightIcon aria-hidden="true" />
    </Button>
  );
}
