/**
 * One value of the vault as a two-line row that opens in place, a managed service's read-only
 * row, the marks of the services that read a value, and the list of what a service reads. Drawn
 * from props only; the panel (`VaultPanel.tsx`) holds which row is open and what is in flight.
 */
import type {
  VaultImpact,
  VaultReader,
  VaultScope,
  VaultValue,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import {
  CheckIcon,
  CopyIcon,
  DicesIcon,
  LockIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  generateVaultValue,
  readerStateWords,
  readSource,
  referenceFor,
  removeGuardWords,
  scopeName,
  valueLine,
  type VaultWordPart,
} from "./vault.logic";

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

/** A service's 16 px mark; amber-ringed while it runs the previous value. */
export function VaultMark({
  monogram,
  restart,
  flat = false,
}: {
  readonly monogram: string;
  readonly restart: boolean;
  readonly flat?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className="vault-mark"
      data-flat={flat ? "" : undefined}
      data-restart={restart ? "" : undefined}
    >
      {monogram}
    </span>
  );
}

const markTip = (reader: VaultReader, key: string, mateName: string | null) =>
  reader.state === "restart"
    ? `${reader.hostname} started before ${key} changed. A restart applies it.${mateName === null ? "" : ` ${mateName} does it with your next message.`}`
    : `${reader.hostname} reads it`;

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
  readonly open: boolean;
  readonly flash: boolean;
  readonly activity: VaultRowActivity;
  readonly monograms: ReadonlyMap<string, string>;
  readonly actor: "mate" | "environment";
  readonly mateName: string | null;
  readonly nowMs: number;
  readonly restarting: ReadonlySet<string>;
  readonly impactOf: (write: VaultWrite) => VaultImpact;
  readonly onToggle: () => void;
  readonly onWrite: (write: VaultWrite) => void;
  readonly onRestart: (serviceId: string, hostname: string) => void;
}

/** One value: its key and readers, then its value or what a sensitive one is; open, its verbs. */
export function VaultRow(props: VaultRowProps) {
  const { value, scope, open, activity } = props;
  const line = valueLine(props.view, scope, value, props.nowMs);
  return (
    <div
      className="vault-row mx-2"
      data-flash={props.flash ? "" : undefined}
      data-open={open ? "" : undefined}
      data-vault-row={value.key}
    >
      <button
        aria-expanded={open}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[20px_17px] items-center gap-x-3 gap-y-px rounded-lg px-2 py-1.75 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={props.onToggle}
        type="button"
      >
        <span className="min-w-0 truncate font-mono font-medium text-line leading-5 text-foreground">
          {value.key}
        </span>
        <span className="relative flex min-h-[18px] items-center justify-end gap-1.5">
          <RowMarks {...props} />
        </span>
        <span className="col-span-2 flex min-w-0 items-center gap-1.25 whitespace-nowrap text-xs leading-4.25 text-muted-foreground">
          {activity.kind === "refused" ? (
            <span
              className="flex min-w-0 items-center gap-1.25 text-destructive-foreground"
              role="alert"
            >
              <TriangleAlertIcon aria-hidden="true" className="size-[11px] shrink-0" />
              <span className="truncate">{activity.reason}</span>
            </span>
          ) : line.kind === "empty" ? (
            <>
              <span className="italic">Empty</span>
              {line.tail === null ? null : <span className="shrink-0">· {line.tail}</span>}
            </>
          ) : line.kind === "sensitive" ? (
            <>
              <LockIcon aria-hidden="true" className="size-[11px] shrink-0" />
              <span className="truncate">{line.text}</span>
            </>
          ) : (
            <>
              <span className="min-w-0 truncate font-mono">{line.text}</span>
              {line.tail === null ? null : <span className="shrink-0">· {line.tail}</span>}
            </>
          )}
        </span>
      </button>
      {activity.kind === "settled" && activity.line !== null && !open ? (
        <p className="px-2 pb-2 -mt-1 text-xs leading-4 text-muted-foreground" data-vault-impact>
          {activity.line}
        </p>
      ) : null}
      <div className="vault-row-body" inert={!open}>
        <div>{open ? <RowBody {...props} /> : null}</div>
      </div>
    </div>
  );
}

function RowMarks(props: VaultRowProps) {
  const { value, activity } = props;
  if (activity.kind === "busy") return <Spinner size="sm" tone="muted" />;
  return (
    <>
      {activity.kind === "settled" && activity.check ? (
        <span
          aria-label="Saved"
          className="vault-settled absolute top-1/2 right-0 z-10 grid size-[18px] -translate-y-1/2 place-items-center rounded-full bg-status-ok-surface text-status-ok-text"
          role="img"
        >
          <CheckIcon aria-hidden="true" className="size-3" />
        </span>
      ) : null}
      {value.readers.length === 0 ? null : (
        <span className="flex items-center" data-vault-marks>
          {value.readers.map((reader) => (
            <Tip key={reader.serviceId} tip={markTip(reader, value.key, props.mateName)}>
              <VaultMark
                monogram={props.monograms.get(reader.hostname) ?? reader.hostname.slice(0, 1)}
                restart={reader.state === "restart"}
              />
            </Tip>
          ))}
        </span>
      )}
    </>
  );
}

function RowBody(props: VaultRowProps) {
  const { value, scope } = props;
  const [draft, setDraft] = useState(value.sensitive ? "" : (value.value ?? ""));
  const [guard, setGuard] = useState(false);
  const busy = props.activity.kind === "busy";
  const reference = referenceFor(scope, value.key);
  const changed = value.sensitive ? draft !== "" : draft !== (value.value ?? "");

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
    <div className="grid gap-2.5 px-2 pt-1 pb-2.5" data-vault-body={value.key}>
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={value.key}
          autoComplete="off"
          className="flex-1"
          font="mono"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") props.onToggle();
          }}
          placeholder={value.sensitive ? "New value" : undefined}
          spellCheck={false}
          type={value.sensitive ? "password" : "text"}
          value={draft}
        />
        {value.sensitive ? (
          <Tip tip="Generate a value · 32 random bytes">
            <Button
              aria-label="Generate a value"
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
      {value.sensitive ? (
        <p className="-mt-1 flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-[11px] shrink-0" />
          <span>Write-only. A new value replaces the current one, which is never shown.</span>
        </p>
      ) : null}

      <div className="grid gap-0.5" data-vault-readers>
        <div className="mb-0.5 font-medium text-2xs text-muted-foreground">Read by</div>
        {value.readers.length === 0 ? (
          <p className="text-xs leading-4.5 text-muted-foreground">
            Nothing reads it yet. It goes live once a zerops.yml references it and that service
            deploys.
          </p>
        ) : (
          value.readers.map((reader) => (
            <div className="flex min-h-[26px] items-center gap-2 text-line" key={reader.serviceId}>
              <VaultMark
                flat
                monogram={props.monograms.get(reader.hostname) ?? reader.hostname.slice(0, 1)}
                restart={reader.state === "restart"}
              />
              <span className="font-medium">{reader.hostname}</span>
              <span className="text-xs text-muted-foreground">at run</span>
              <span className="grow" />
              <span
                className={
                  reader.state === "restart"
                    ? "flex items-center gap-1.5 text-xs text-warning-foreground"
                    : "flex items-center gap-1.5 text-xs text-muted-foreground"
                }
              >
                {reader.state === "live" ? (
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-status-ok" />
                ) : null}
                {readerStateWords(reader.state)}
              </span>
              {reader.state === "restart" && props.actor === "environment" ? (
                <Button
                  disabled={props.restarting.has(reader.serviceId)}
                  onClick={() => props.onRestart(reader.serviceId, reader.hostname)}
                  size="xs"
                  variant="outline"
                >
                  {props.restarting.has(reader.serviceId) ? (
                    <Spinner size="xs" />
                  ) : (
                    <RotateCwIcon />
                  )}
                  Restart {reader.hostname}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-0.5 border-t border-border/60 pt-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Used as <code className="font-mono">{reference.own}</code>
          <CopyReference text={reference.own} />
        </span>
        {reference.other === null ? null : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            · elsewhere <code className="font-mono">{reference.other}</code>
            <CopyReference text={reference.other} />
          </span>
        )}
        <span className="grow" />
        {value.sensitive ? null : (
          <Button
            disabled={busy}
            onClick={() =>
              props.onWrite({
                kind: "update",
                id: value.id,
                key: value.key,
                value: value.value ?? "",
                sensitive: true,
              })
            }
            size="xs"
            variant="ghost-muted"
          >
            Make sensitive
          </Button>
        )}
        <Button disabled={busy} onClick={remove} size="xs" variant="ghost-destructive">
          Remove
        </Button>
      </div>

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

/** A value Zerops made for a managed service: read only, with its reference to copy. */
export function VaultManagedRow({
  scope,
  value,
}: {
  readonly scope: VaultScope;
  readonly value: VaultValue;
}) {
  const reference = referenceFor(scope, value.key).own;
  return (
    <div className="vault-row mx-2" data-static="" data-vault-row={value.key}>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[20px_17px] items-center gap-x-3 gap-y-px px-2 py-1.75">
        <span className="min-w-0 truncate font-mono font-medium text-line leading-5 text-foreground">
          {value.key}
        </span>
        <span className="flex items-center justify-end">
          <CopyReference label={reference} text={reference} />
        </span>
        <span className="col-span-2 flex min-w-0 items-center gap-1.25 whitespace-nowrap text-xs leading-4.25 text-muted-foreground">
          {value.sensitive ? (
            <>
              <LockIcon aria-hidden="true" className="size-[11px] shrink-0" />
              <span className="truncate">Sensitive · made by Zerops</span>
            </>
          ) : (
            <span className="min-w-0 truncate font-mono">{value.value}</span>
          )}
        </span>
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
