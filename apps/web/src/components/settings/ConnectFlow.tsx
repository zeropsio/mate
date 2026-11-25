/**
 * The card a connection's row unfolds to connect it (GitHub, Slack, Discord): numbered steps, each
 * a short title and one line of help; the keys it takes stacked full width, each with where to
 * find it; every address the other side must be given shown up front with its Copy; and at the
 * end one Connect, pressable once every key holds, beside a quiet Cancel.
 */
import { ArrowUpRightIcon } from "lucide-react";
import { useId, type FormEvent, type ReactNode } from "react";

import { CopyLine } from "~/components/ui/copy-line";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Text } from "~/components/ui/text";
import { Card } from "~/components/ui/card";
import { StepNumber } from "~/components/ui/step-number";
import { Separator } from "~/components/ui/separator";

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
          <Text render={<p />} variant="error" role="alert">
            {problem}
          </Text>
        ) : null}
        <Separator />
        <div className="flex items-center gap-2">
          <Text className="min-w-0 flex-1" render={<p />} variant="note">
            {note}
          </Text>
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
  return (
    <Card variant="inset">
      <div className="p-4">{children}</div>
    </Card>
  );
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
      <StepNumber className="mt-px" n={n} size="sm" />
      <div className="grid min-w-0 gap-3">
        <div className="grid gap-0.5">
          <Text render={<p />} variant="heading">
            <span className="sr-only">{`Step ${String(n)}: `}</span>
            {title}
          </Text>
          {help ? (
            <Text render={<p />} variant="note">
              {help}
            </Text>
          ) : null}
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
        <Text render={<p />} variant="note" id={`${id}-hint`}>
          {hint}
        </Text>
      ) : (
        <Text render={<p />} variant="error" id={`${id}-hint`} role="alert">
          {problem}
        </Text>
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
  return (
    <div className="grid gap-1.5">
      <Text render={<p />} variant="heading">
        {label}
      </Text>
      <CopyLine label={`the ${label}`} value={value} />
      {hint ? (
        <Text render={<p />} variant="note">
          {hint}
        </Text>
      ) : null}
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
      <Text render={<p />} variant="heading">
        {label}
      </Text>
      <CopyLine label={`the ${label}`} placeholder={words} value={null} />
      {hint ? (
        <Text render={<p />} variant="note">
          {hint}
        </Text>
      ) : null}
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
