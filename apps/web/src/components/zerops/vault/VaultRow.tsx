/**
 * One value of the vault as a one-line row that opens in place, a managed service folded to one
 * line, and the list of what a service reads. Drawn from props only; the panel (`VaultPanel.tsx`)
 * holds which row is open and what is in flight.
 */
import type {
  VaultImpact,
  VaultScope,
  VaultValue,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DatabaseIcon,
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
  joinNames,
  readSource,
  referenceFor,
  removeGuardWords,
  scopeName,
  type VaultWordPart,
} from "./vault.logic";
import {
  isSignInPassword,
  looksSecret,
  showOf,
  staleApps,
  usedByWords,
  type VaultShow,
} from "./vaultGroups.logic";

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
    <Tip tip={isCopied ? "Copied" : "Copy"}>
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
  /** The value's name in words; its key shows when the row opens. */
  readonly label: string;
  /** The one app that has it, when the list shows every app's values. */
  readonly only: string | null;
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
}

/** One value on one line — its name in words, then the value or what stands for it; open, its verbs. */
export function VaultRow(props: VaultRowProps) {
  const { value, open, activity } = props;
  return (
    <div
      className="vault-row mx-2"
      data-flash={props.flash ? "" : undefined}
      data-open={open ? "" : undefined}
      data-vault-row={value.key}
    >
      <button
        aria-expanded={open}
        className="grid h-9 w-full grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-x-4 rounded-lg px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={props.onToggle}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-line text-foreground">{props.label}</span>
          {props.only === null ? null : (
            <span className="vault-only shrink-0 truncate text-2xs text-muted-foreground">
              only {props.only}
            </span>
          )}
        </span>
        <span className="vault-row-value relative flex min-w-0 items-center gap-1.5 text-line text-muted-foreground">
          {activity.kind === "busy" ? <Spinner size="sm" tone="muted" /> : null}
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
          className="px-2.5 pb-2 -mt-0.5 text-xs leading-4 text-muted-foreground"
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
  const [guard, setGuard] = useState(false);
  const [locking, setLocking] = useState(false);
  const busy = props.activity.kind === "busy";
  const reference = referenceFor(scope, value.key);
  const changed = value.sensitive ? draft !== "" : draft !== (value.value ?? "");
  const restarts = staleApps(props.view, scope, value).map((app) => ({
    serviceId: app.id,
    hostname: app.hostname ?? "",
  }));
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  const save = () => {
    if (!changed || busy) return;
    props.onWrite({
      kind: "update",
      id: value.id,
      key: value.key,
      value: draft,
      sensitive: value.sensitive,
    });
  };
  const remove = () => {
    if (value.readers.length > 0 && !guard) return setGuard(true);
    props.onWrite({ kind: "remove", id: value.id, key: value.key });
  };

  return (
    <div className="grid gap-2.5 px-2.5 pt-0.5 pb-3" data-vault-body={value.key}>
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
          placeholder={value.sensitive ? "Paste a new value to replace it" : "Not set"}
          spellCheck={false}
          type={value.sensitive || (masked && !reveal) ? "password" : "text"}
          value={draft}
        />
        {masked ? (
          <Tip tip={reveal ? "Hide" : "Show"}>
            <Button
              aria-label={reveal ? "Hide" : "Show"}
              onClick={() => setReveal((current) => !current)}
              size="icon-sm"
              variant="ghost-muted"
            >
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </Tip>
        ) : null}
        {!value.sensitive && (value.value ?? "") !== "" ? (
          <Tip tip={isCopied ? "Copied" : "Copy"}>
            <Button
              aria-label="Copy"
              onClick={() => copyToClipboard(value.value ?? "", undefined)}
              size="icon-sm"
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
              size="icon-sm"
              variant="ghost-muted"
            >
              <DicesIcon />
            </Button>
          </Tip>
        ) : null}
        <Button disabled={!changed || busy} onClick={save} size="sm">
          {busy ? <Spinner size="xs" /> : null}
          {busy ? "Saving" : "Save"}
        </Button>
      </div>

      <div className="grid gap-1 text-xs leading-4.5 text-muted-foreground" data-vault-readers>
        {value.sensitive ? (
          <p className="flex items-center gap-1.5">
            <LockIcon aria-hidden="true" className="size-3 shrink-0" />
            Secret — nobody can read it back, not you and not {props.mateName ?? "your Mate"}. Your
            apps still get it.
          </p>
        ) : null}
        <p>
          {usedByWords(scope)}
          {restarts.length > 0 ? (
            <span className="text-warning-foreground">
              {" "}
              {joinNames(restarts.map((reader) => reader.hostname))}{" "}
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
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <code className="truncate font-mono">{value.key}</code>
          <CopyReference text={reference.own} />
        </span>
        <span className="grow" />
        {!masked ? null : (
          <Button disabled={busy} onClick={() => setLocking(true)} size="xs" variant="ghost-muted">
            <LockIcon />
            Make secret
          </Button>
        )}
        <Button disabled={busy} onClick={remove} size="xs" variant="ghost-destructive">
          Remove
        </Button>
      </div>

      {locking ? (
        <div
          aria-label={`Make ${props.label} secret`}
          className="grid gap-2.5 rounded-md bg-muted/60 px-3 py-2.5 text-line leading-4.75"
          role="alertdialog"
        >
          <p>
            Once it's secret, nobody can read it back — not you, not {props.mateName ?? "your Mate"}
            . Your apps still get it.
            {isSignInPassword(value.key)
              ? " You sign in with this one: copy it somewhere safe first."
              : ""}
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
              Make it secret
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

/** A service Zerops runs for the environment (a database): folded to one line, its values read only. */
export function VaultManagedFold({
  scope,
  open,
  onToggle,
}: {
  readonly scope: VaultScope;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const type = scope.serviceType?.split("@")[0] ?? null;
  return (
    <div className="vault-row mx-2" data-open={open ? "" : undefined} data-vault-managed={scope.id}>
      <button
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onToggle}
        type="button"
      >
        <DatabaseIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-line text-foreground">{scope.hostname}</span>
        {type === null ? null : (
          <span className="truncate text-xs text-muted-foreground">{type}</span>
        )}
        <span className="grow" />
        <span className="shrink-0 text-xs text-muted-foreground">
          {scope.values.length} {scope.values.length === 1 ? "value" : "values"}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="vault-chevron size-3.5 shrink-0 text-muted-foreground"
        />
      </button>
      <div className="vault-row-body" inert={!open}>
        <div>
          {open ? (
            <div className="grid pb-2">
              <p className="px-2.5 pb-1 text-xs text-muted-foreground">
                Made by Zerops, read only. An app uses one by its name.
              </p>
              {scope.values.map((value) => {
                const reference = referenceFor(scope, value.key).own;
                return (
                  <div
                    className="grid h-8 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-x-4 px-2.5"
                    data-vault-row={value.key}
                    key={value.id}
                  >
                    <span className="truncate font-mono text-xs text-foreground">{value.key}</span>
                    <span className="flex min-w-0 items-center gap-1 text-line text-muted-foreground">
                      <span className="min-w-0 grow truncate">
                        {value.sensitive || looksSecret(value.key) ? (
                          <span className="vault-dots">{DOTS}</span>
                        ) : (
                          value.value
                        )}
                      </span>
                      <CopyReference text={reference} />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** What a runtime service reads from its deployed zerops.yml: each key and where it comes from. */
export function VaultReads({
  view,
  scope,
  onGoto,
}: {
  readonly view: VaultView;
  readonly scope: VaultScope;
  readonly onGoto: (scopeId: string, key: string) => void;
}) {
  const host = scopeName(scope);
  return (
    <div data-vault-reads={host}>
      <div className="vault-section h-[30px] px-4 pt-1.5 font-medium text-2xs text-muted-foreground">
        <span>What {host} reads</span>
      </div>
      {scope.reads.length === 0 ? (
        <p className="mx-4 mt-1 text-xs text-muted-foreground">Nothing deployed yet.</p>
      ) : (
        <div className="grid px-2 pt-0.5">
          {scope.reads.map((read) => {
            const source = readSource(view, scope, read);
            const target = source.kind === "source" ? source.target : null;
            const restart = view.scopes.some((candidate) =>
              candidate.values.some(
                (value) =>
                  target !== null &&
                  candidate.id === target.scopeId &&
                  value.key === target.key &&
                  value.readers.some(
                    (reader) => reader.serviceId === scope.id && reader.state === "restart",
                  ),
              ),
            );
            const content = (
              <>
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs leading-5 text-foreground">
                  <span className="truncate">{read.key}</span>
                  {restart ? (
                    <Tip tip={`${host} runs the previous value`}>
                      <span className="size-1.5 rounded-full bg-warning" />
                    </Tip>
                  ) : null}
                </span>
                <ReadSourceLabel host={host} source={source} />
              </>
            );
            return target === null ? (
              <div
                className="grid h-[30px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2"
                data-vault-read={read.key}
                key={read.key}
              >
                {content}
              </div>
            ) : (
              <button
                className="grid h-[30px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 vault-read-link rounded-md px-2 text-left"
                data-vault-read={read.key}
                key={read.key}
                onClick={() => onGoto(target.scopeId, target.key)}
                type="button"
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
      <p className="mx-4 mt-2 text-xs text-muted-foreground">From the deployed zerops.yml</p>
    </div>
  );
}

function ReadSourceLabel({
  host,
  source,
}: {
  readonly host: string;
  readonly source: ReturnType<typeof readSource>;
}) {
  if (source.kind === "literal") {
    return (
      <span className="max-w-40 truncate font-mono text-xs text-muted-foreground">
        {source.text}
      </span>
    );
  }
  if (source.kind === "bad") {
    return (
      <Tip
        tip={
          source.text === "self"
            ? `${host}'s zerops.yml sets it to \${${source.name}}, so the app gets that literal text`
            : `Nothing has \${${source.name}}, so ${host} gets the literal text`
        }
      >
        <span className="inline-flex items-center gap-0.75 font-medium text-2xs text-warning-foreground">
          <TriangleAlertIcon aria-hidden="true" className="size-[11px]" />
          {source.text}
        </span>
      </Tip>
    );
  }
  return <span className="font-medium text-2xs text-muted-foreground">← {source.text}</span>;
}
