/**
 * The vault's rows: one value as a one-line row that opens in place, and a service Zerops runs as
 * read-only rows. Drawn from props only; the panel (`VaultPanel.tsx`) holds which row is open and
 * what is in flight.
 */
import type {
  VaultImpact,
  VaultRevealed,
  VaultScope,
  VaultScopeRef,
  VaultValue,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import {
  CheckIcon,
  CopyIcon,
  DicesIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { MiddleTruncate } from "../../ui/middle-truncate";
import { Spinner } from "../../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  generateVaultValue,
  referenceFor,
  removeGuardWords,
  type VaultWordPart,
} from "./vault.logic";
import {
  looksSecret,
  revealRefusalWords,
  SUDO_REFUSAL,
  showOf,
  usedByWords,
  type VaultShow,
} from "./vaultGroups.logic";
import { VaultStepUp } from "./VaultStepUp";

/** What one row is doing now, as the panel knows it. */
export type VaultRowActivity =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "settled"; readonly line: string | null; readonly check: boolean }
  | { readonly kind: "refused"; readonly reason: string };

/** Each part with where it starts in the sentence: its key. */
function placeWords(parts: ReadonlyArray<VaultWordPart>) {
  let offset = 0;
  return parts.map((part) => {
    const at = offset;
    offset += part.text.length;
    return { part, at };
  });
}

export function VaultWords({ parts }: { readonly parts: ReadonlyArray<VaultWordPart> }) {
  const placed = placeWords(parts);
  return (
    <>
      {placed.map(({ part, at: index }) =>
        part.kind === "strong" ? (
          <b className="font-medium" key={index}>
            {part.text}
          </b>
        ) : part.kind === "code" ? (
          <code className="font-mono font-medium" key={index}>
            {part.text}
          </code>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Tip({ tip, children }: { readonly tip: string; readonly children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipPopup>{tip}</TooltipPopup>
    </Tooltip>
  );
}

function CopyReference({ text, label }: { readonly text: string; readonly label?: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Tip
      tip={
        isCopied ? "Copied" : label === undefined ? `Copy ${text}` : "Copy it into a deploy config"
      }
    >
      <Button
        aria-label={`Copy ${text}`}
        data-vault-copy={text}
        onClick={(event) => {
          event.stopPropagation();
          copyToClipboard(text, undefined);
        }}
        size={label === undefined ? "icon-xs" : "xs"}
        variant="ghost-muted"
      >
        {label === undefined ? null : <span className="font-mono font-normal">{label}</span>}
        {isCopied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </Tip>
  );
}

export interface VaultRowProps {
  readonly view: VaultView;
  readonly scope: VaultScope;
  readonly value: VaultValue;
  /** The value's name in words; its key stands beside it. */
  readonly label: string;
  readonly open: boolean;
  readonly flash: boolean;
  readonly activity: VaultRowActivity;
  readonly actor: "mate" | "environment";
  readonly mateName: string | null;
  readonly nowMs: number;
  readonly restarting: ReadonlySet<string>;
  readonly impactOf: (write: VaultWrite) => VaultImpact;
  readonly onToggle: () => void;
  readonly onWrite: (write: VaultWrite) => void;
  readonly onRestart: (serviceId: string, hostname: string) => void;
  /** Decrypts a secret for the person who asks; absent where nothing can. */
  readonly onReveal?: ((scope: VaultScopeRef, id: string) => Promise<VaultRevealed>) | undefined;
}

/**
 * One value on one line: its name in words and its key at the left, the value at the right, a
 * mark when an app still runs the old one; open, its verbs.
 */
export function VaultRow(props: VaultRowProps) {
  const { value, open, activity } = props;
  const stale = value.readers.some((reader) => reader.state === "restart");
  return (
    <div
      className="vault-row"
      data-flash={props.flash ? "" : undefined}
      data-open={open ? "" : undefined}
      data-vault-row={value.key}
    >
      <button
        aria-expanded={open}
        className="flex h-11 w-full items-center gap-3 px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={props.onToggle}
        type="button"
      >
        <span className="flex min-w-0 shrink items-center gap-2">
          <span className="truncate text-line text-foreground">{props.label}</span>
          <code className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
            {value.key}
          </code>
        </span>
        <span className="vault-row-value ml-auto flex min-w-0 max-w-[62%] items-center justify-end gap-1.5 text-line text-muted-foreground">
          {activity.kind === "busy" ? <Spinner size="sm" tone="muted" /> : null}
          {stale && activity.kind !== "busy" ? (
            <RotateCwIcon
              aria-label="An app still runs the old value"
              className="size-3 shrink-0 text-warning-foreground"
              data-vault-stale=""
              role="img"
            />
          ) : null}
          {activity.kind === "settled" && activity.check ? (
            <span
              aria-label="Saved"
              className="vault-settled grid size-[18px] shrink-0 place-items-center rounded-full bg-status-ok-surface text-status-ok-text"
              role="img"
            >
              <CheckIcon aria-hidden="true" className="size-3" />
            </span>
          ) : null}
          {activity.kind === "refused" ? (
            <span
              className="flex min-w-0 items-center gap-1.25 text-destructive-foreground"
              role="alert"
            >
              <TriangleAlertIcon aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">{activity.reason}</span>
            </span>
          ) : (
            <VaultShown show={showOf(value)} />
          )}
        </span>
      </button>
      {activity.kind === "settled" && activity.line !== null && !open ? (
        <p
          className="px-3.5 pb-2.5 -mt-1 text-xs leading-4 text-muted-foreground"
          data-vault-impact
        >
          {activity.line}
        </p>
      ) : null}
      <div className="vault-row-body" inert={!open}>
        <div>{open ? <RowBody {...props} /> : null}</div>
      </div>
    </div>
  );
}

const DOTS = "●●●●●●●●";

/** Each part of a value with where it starts in the value: its key. */
function placeParts(parts: Extract<VaultShow, { kind: "text" }>["parts"]) {
  let offset = 0;
  return parts.map((part) => {
    const at = offset;
    offset += part.text.length + (part.ref ? 3 : 0);
    return { part, at };
  });
}

/** A closed row's value: the text, its references as quiet chips, dots for what stays hidden. */
export function VaultShown({ show }: { readonly show: VaultShow }) {
  switch (show.kind) {
    case "unset":
      return <span className="text-muted-foreground/70">Not set</span>;
    case "secret":
      return (
        <span className="flex items-center gap-1.5">
          <span className="vault-dots">{DOTS}</span>
          <LockIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
        </span>
      );
    case "masked":
      return <span className="vault-dots">{DOTS}</span>;
    case "text":
      if (show.parts.every((part) => !part.ref)) {
        return <MiddleTruncate tail={12} value={show.parts.map((part) => part.text).join("")} />;
      }
      return (
        <span className="min-w-0 truncate">
          {placeParts(show.parts).map(({ part, at }) =>
            part.ref ? (
              <span className="vault-ref" key={at}>
                {part.text}
              </span>
            ) : (
              <span key={at}>{part.text}</span>
            ),
          )}
        </span>
      );
  }
}

function RowBody(props: VaultRowProps) {
  const { value, scope } = props;
  const masked = !value.sensitive && looksSecret(value.key);
  const [draft, setDraft] = useState(value.sensitive ? "" : (value.value ?? ""));
  const [reveal, setReveal] = useState(false);
  /** A secret as Zerops decrypted it for this person, held only while the row is open. */
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealRefusal, setRevealRefusal] = useState<string | null>(null);
  /** The refusal asked for sudo mode: the person can confirm in Zerops, then it shows. */
  const [stepUp, setStepUp] = useState(false);
  const show = async () => {
    if (props.onReveal === undefined) return;
    setRevealing(true);
    const answer = await props.onReveal(scope.ref, value.id);
    setRevealing(false);
    if (answer.ok) {
      setRevealed(answer.value);
      setDraft(answer.value);
      setReveal(true);
      setRevealRefusal(null);
      setStepUp(false);
    } else {
      setRevealRefusal(revealRefusalWords(answer.code));
      setStepUp(answer.code === SUDO_REFUSAL);
    }
  };
  const [guard, setGuard] = useState(false);
  const [locking, setLocking] = useState(false);
  const busy = props.activity.kind === "busy";
  const reference = referenceFor(scope, value.key);
  const changed = value.sensitive
    ? draft !== "" && draft !== revealed
    : draft !== (value.value ?? "");
  const restarts = value.readers.filter((reader) => reader.state === "restart");
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  // A value not set yet whose name says secret is saved hidden.
  const unset = !value.sensitive && (value.value ?? "") === "";
  const save = () => {
    if (!changed || busy) return;
    props.onWrite({
      kind: "update",
      id: value.id,
      key: value.key,
      value: draft,
      sensitive: value.sensitive || (unset && looksSecret(value.key)),
    });
  };
  const remove = () => {
    if (value.readers.length > 0 && !guard) return setGuard(true);
    props.onWrite({ kind: "remove", id: value.id, key: value.key });
  };

  return (
    <div className="grid gap-2.5 px-3.5 pt-0.5 pb-3" data-vault-body={value.key}>
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={props.label}
          autoComplete="off"
          className="flex-1"
          font={value.sensitive || masked ? "mono" : "default"}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") props.onToggle();
          }}
          placeholder={
            value.sensitive ? "Hidden · paste a new value to replace it" : "Paste it here"
          }
          spellCheck={false}
          type={(value.sensitive || masked) && !reveal ? "password" : "text"}
          value={draft}
        />
        {value.sensitive && props.onReveal !== undefined && revealed === null ? (
          <Tip tip="Show it to you">
            <Button
              aria-label="Show"
              disabled={revealing}
              onClick={() => void show()}
              size="icon-md"
              variant="ghost-muted"
            >
              {revealing ? <Spinner size="xs" /> : <EyeIcon />}
            </Button>
          </Tip>
        ) : null}
        {masked || (value.sensitive && revealed !== null) ? (
          <Tip tip={reveal ? "Hide" : "Show"}>
            <Button
              aria-label={reveal ? "Hide" : "Show"}
              onClick={() => setReveal((current) => !current)}
              size="icon-md"
              variant="ghost-muted"
            >
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </Tip>
        ) : null}
        {(!value.sensitive && (value.value ?? "") !== "") || revealed !== null ? (
          <Tip tip={isCopied ? "Copied" : "Copy"}>
            <Button
              aria-label="Copy"
              onClick={() => copyToClipboard(revealed ?? value.value ?? "", undefined)}
              size="icon-md"
              variant="ghost-muted"
            >
              {isCopied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </Tip>
        ) : null}
        {value.sensitive ? (
          <Tip tip="Make up a new random value">
            <Button
              aria-label="Make up a value"
              onClick={() => setDraft(generateVaultValue())}
              size="icon-md"
              variant="ghost-muted"
            >
              <DicesIcon />
            </Button>
          </Tip>
        ) : null}
        <Button disabled={!changed || busy} onClick={save} size="md">
          {busy ? <Spinner size="xs" /> : null}
          {busy ? "Saving" : "Save"}
        </Button>
      </div>

      <div className="grid gap-1 text-xs leading-4.5 text-muted-foreground" data-vault-readers>
        {value.sensitive ? (
          <p className="flex items-center gap-1.5">
            <LockIcon aria-hidden="true" className="size-3 shrink-0" />
            Hidden from everyone, {props.mateName ?? "your Mate"} included. Your apps still get it.
          </p>
        ) : null}
        {revealRefusal === null ? null : (
          <p className="text-destructive-foreground" role="alert">
            {revealRefusal}
          </p>
        )}
        {stepUp ? <VaultStepUp onConfirmed={() => void show()} /> : null}
        <p>
          {usedByWords(value)}
          {restarts.length > 0 ? (
            <span className="text-warning-foreground">
              {" "}
              {restarts.map((reader) => reader.hostname).join(", ")}{" "}
              {restarts.length === 1 ? "still runs" : "still run"} the old value
              {props.actor === "mate" && props.mateName !== null
                ? ` — ${props.mateName} applies it with your next message.`
                : "."}
            </span>
          ) : null}
        </p>
        {props.actor === "environment" && restarts.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {restarts.map((reader) => (
              <Button
                disabled={props.restarting.has(reader.serviceId)}
                key={reader.serviceId}
                onClick={() => props.onRestart(reader.serviceId, reader.hostname)}
                size="xs"
                variant="outline"
              >
                {props.restarting.has(reader.serviceId) ? <Spinner size="xs" /> : <RotateCwIcon />}
                Restart {reader.hostname}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-0.5 border-t border-border/60 pt-2">
        <CopyReference label={reference.own} text={reference.own} />
        <span className="grow" />
        {!masked ? null : (
          <Button disabled={busy} onClick={() => setLocking(true)} size="xs" variant="ghost-muted">
            <EyeOffIcon />
            Hide it
          </Button>
        )}
        <Button disabled={busy} onClick={remove} size="xs" variant="ghost-destructive">
          Remove
        </Button>
      </div>

      {locking ? (
        <div
          aria-label={`Hide ${props.label}`}
          className="grid gap-2.5 rounded-md bg-muted/60 px-3 py-2.5 text-line leading-4.75"
          role="alertdialog"
        >
          <p>
            Nobody reads it back once it's hidden, {props.mateName ?? "your Mate"} included. You can
            still show it to yourself here, and your apps still get it.
          </p>
          <div className="flex justify-end gap-1.5">
            <Button onClick={() => setLocking(false)} size="xs" variant="ghost-muted">
              Cancel
            </Button>
            <Button
              onClick={() => {
                setLocking(false);
                props.onWrite({
                  kind: "update",
                  id: value.id,
                  key: value.key,
                  value: value.value ?? "",
                  sensitive: true,
                });
              }}
              size="xs"
            >
              Hide it
            </Button>
          </div>
        </div>
      ) : null}

      {guard ? (
        <div
          aria-label={`Remove ${value.key}`}
          className="grid gap-2.5 rounded-md bg-warning-surface px-3 py-2.5 text-line leading-4.75"
          role="alertdialog"
        >
          <p>
            <VaultWords
              parts={removeGuardWords(
                value.key,
                value.readers.map((reader) => reader.hostname),
              )}
            />
          </p>
          <div className="flex justify-end gap-1.5">
            <Button onClick={remove} size="xs" variant="ghost-destructive">
              Remove anyway
            </Button>
            <Button onClick={() => setGuard(false)} size="xs" variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A service Zerops runs for the environment (a database): its values, read only. */
export function VaultManagedRows({
  scope,
  onReveal,
}: {
  readonly scope: VaultScope;
  readonly onReveal?: ((scope: VaultScopeRef, id: string) => Promise<VaultRevealed>) | undefined;
}) {
  return (
    <>
      {scope.values.map((value) => (
        <VaultManagedRow key={value.id} onReveal={onReveal} scope={scope} value={value} />
      ))}
    </>
  );
}

function VaultManagedRow({
  scope,
  value,
  onReveal,
}: {
  readonly scope: VaultScope;
  readonly value: VaultValue;
  readonly onReveal?: ((scope: VaultScopeRef, id: string) => Promise<VaultRevealed>) | undefined;
}) {
  const reference = referenceFor(scope, value.key).own;
  const hidden = value.sensitive || looksSecret(value.key);
  const [shown, setShown] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const show = async () => {
    if (!value.sensitive) return setShown(value.value ?? "");
    if (onReveal === undefined) return;
    const answer = await onReveal(scope.ref, value.id);
    setStepUp(!answer.ok && answer.code === SUDO_REFUSAL);
    if (answer.ok) {
      setShown(answer.value);
      setRefusal(null);
    } else setRefusal(revealRefusalWords(answer.code));
  };
  return (
    <div
      className="vault-row flex min-h-11 flex-wrap items-center gap-x-3 px-3.5 py-1"
      data-static=""
      data-vault-row={value.key}
    >
      <span className="min-w-0 shrink truncate text-line text-foreground">{value.key}</span>
      <span className="ml-auto flex min-w-0 max-w-[62%] items-center justify-end gap-1 text-line text-muted-foreground">
        <span className="min-w-0 truncate" data-vault-shown={shown === null ? undefined : ""}>
          {hidden && shown === null ? (
            <span className="vault-dots">{DOTS}</span>
          ) : (
            (shown ?? value.value)
          )}
        </span>
        {hidden && (onReveal !== undefined || !value.sensitive) ? (
          <Tip tip={shown === null ? "Show it to you" : "Hide"}>
            <Button
              aria-label={shown === null ? "Show" : "Hide"}
              onClick={() => (shown === null ? void show() : setShown(null))}
              size="icon-xs"
              variant="ghost-muted"
            >
              {shown === null ? <EyeIcon /> : <EyeOffIcon />}
            </Button>
          </Tip>
        ) : null}
        <CopyReference text={reference} />
      </span>
      {refusal === null ? null : (
        <p className="w-full pb-1.5 text-xs text-destructive-foreground" role="alert">
          {refusal}
        </p>
      )}
      {stepUp ? (
        <div className="w-full pb-1.5 text-xs text-muted-foreground">
          <VaultStepUp onConfirmed={() => void show()} />
        </div>
      ) : null}
    </div>
  );
}
