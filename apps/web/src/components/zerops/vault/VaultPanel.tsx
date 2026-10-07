/**
 * The Vault tab: one environment's values beside a Mate's conversation, for people as much as for
 * developers — one list in groups named for what each value is for (Admin sign-in, Stripe, Email,
 * Addresses…), each value on one line under its name in words; what needs the person on top
 * (values not set, secrets anyone can read, changes not live yet); the databases Zerops runs
 * folded at the foot. An "All apps" menu narrows it to one app's own values and what that app
 * reads; Edit as text sits behind the "⋯".
 *
 * `VaultPanelBody` draws a view it is given and reports writes and restarts; the container
 * (`VaultPanelContainer.tsx`) feeds it from the account's `vault` projection and operations; the
 * harness (`/design-vault.html`) draws it over the fixture.
 */
import type {
  VaultImpact,
  VaultNotLive as VaultNotLiveItem,
  VaultScope,
  VaultScopeRef,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  TextIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, InlineButton } from "../../ui/button";
import { Input } from "../../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../../ui/menu";
import { Skeleton } from "../../ui/skeleton";
import { Spinner } from "../../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { impactLine, joinNames, notLiveTarget, refusalWords, vaultRowKey } from "./vault.logic";
import { VaultAddCard, VaultReview, VaultTextEditor } from "./VaultEditors";
import {
  looksSecret,
  unsetTitle,
  vaultGroups,
  vaultNeeds,
  type VaultEntry,
  type VaultFilter,
} from "./vaultGroups.logic";
import { VaultNotLive } from "./VaultNotLive";
import { VaultManagedFold, VaultReads, VaultRow, type VaultRowActivity } from "./VaultRow";
import { diffVaultText, pasteIntoText, vaultToText, type VaultText } from "./vaultText.logic";

/** What the account knows of one row's write: in flight, or refused with the platform's code. */
export type VaultPending =
  | { readonly kind: "saving" }
  | { readonly kind: "removing" }
  | { readonly kind: "refused"; readonly code: string | null; readonly message: string | null };

export type VaultWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string | null; readonly message: string | null };

export interface VaultPanelBodyProps {
  readonly view: VaultView;
  /** Beside a Mate, it makes things live with the next message; else the person restarts. */
  readonly actor: "mate" | "environment";
  /** Whose environment: the Mate's face and name, or the environment's name without one. */
  readonly who:
    | {
        readonly kind: "mate";
        readonly name: string;
        readonly tint: MateTintId;
        readonly shape?: MateShapeId | undefined;
      }
    | { readonly kind: "environment"; readonly name: string };
  /** Writes in flight or refused, by `vaultRowKey(scope id, key)`. */
  readonly pending: ReadonlyMap<string, VaultPending>;
  /** Services restarting now, by id. */
  readonly restarting: ReadonlySet<string>;
  readonly impactOf: (scope: VaultScopeRef, write: VaultWrite) => VaultImpact;
  readonly onWrite: (scope: VaultScopeRef, write: VaultWrite) => Promise<VaultWriteOutcome>;
  readonly onRestart: (serviceId: string) => Promise<void>;
  /** The clock relative times are read against; now when absent. */
  readonly nowMs?: number;
}

const SETTLE_MS = 1400;
const IMPACT_MS = 8000;
const FLASH_MS = 1500;
const ALL: VaultFilter = { kind: "all" };

type Mode =
  | { readonly kind: "list" }
  | { readonly kind: "add" }
  | { readonly kind: "text"; readonly text: VaultText }
  | {
      readonly kind: "review";
      readonly text: VaultText;
      readonly writes: ReadonlyArray<VaultWrite>;
    };

interface Local {
  /** Writes this panel sent and has not heard back about, by row key. */
  readonly sending: ReadonlySet<string>;
  readonly refused: ReadonlyMap<string, string>;
  /** Rows that just saved: their check, then their impact line until it times out. */
  readonly settled: ReadonlyMap<string, { readonly at: number; readonly line: string | null }>;
}

const EMPTY_LOCAL: Local = { sending: new Set(), refused: new Map(), settled: new Map() };

export function VaultPanelBody(props: VaultPanelBodyProps) {
  const { view } = props;
  const [clock, setClock] = useState(() => Date.now());
  const nowMs = props.nowMs ?? clock;
  const [filter, setFilter] = useState<VaultFilter>(ALL);
  const [query, setQuery] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [applying, setApplying] = useState(false);
  const [local, setLocal] = useState<Local>(EMPTY_LOCAL);
  const [restartingLocal, setRestartingLocal] = useState<ReadonlySet<string>>(() => new Set());
  const findInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  const shared = view.scopes.find((candidate) => candidate.kind === "shared");
  const app =
    filter.kind === "app" ? view.scopes.find((candidate) => candidate.id === filter.id) : undefined;
  // Where Add and Edit as text write: the app picked, else the whole environment.
  const target = app ?? shared;
  const mateName = props.who.kind === "mate" ? props.who.name : null;
  const restarting = new Set([...props.restarting, ...restartingLocal]);
  const q = query.trim();

  // A settled row's check and impact line go on their own.
  const settledCount = local.settled.size;
  useEffect(() => {
    if (settledCount === 0) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setClock(at);
      setLocal((current) => {
        const settled = new Map(
          [...current.settled].filter(([, entry]) => at - entry.at < IMPACT_MS),
        );
        return settled.size === current.settled.size ? current : { ...current, settled };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [settledCount]);

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const activityOf = (scope: VaultScope, key: string): VaultRowActivity => {
    const rowKey = vaultRowKey(scope.id, key);
    const pending = props.pending.get(rowKey);
    if (local.sending.has(rowKey) || pending?.kind === "saving" || pending?.kind === "removing") {
      return { kind: "busy" };
    }
    const refusedHere = local.refused.get(rowKey);
    if (refusedHere !== undefined) return { kind: "refused", reason: refusedHere };
    if (pending?.kind === "refused") {
      return { kind: "refused", reason: refusalWords(pending.code, scope, key, pending.message) };
    }
    const settled = local.settled.get(rowKey);
    if (settled !== undefined) {
      return { kind: "settled", line: settled.line, check: nowMs - settled.at < SETTLE_MS };
    }
    return { kind: "idle" };
  };

  const write = async (scope: VaultScope, change: VaultWrite): Promise<boolean> => {
    const rowKey = vaultRowKey(scope.id, change.key);
    const impact = props.impactOf(scope.ref, change);
    setLocal((current) => {
      const refused = new Map(current.refused);
      refused.delete(rowKey);
      return { ...current, sending: new Set(current.sending).add(rowKey), refused };
    });
    let outcome: VaultWriteOutcome;
    try {
      outcome = await props.onWrite(scope.ref, change);
    } catch (cause) {
      outcome = { ok: false, code: null, message: cause instanceof Error ? cause.message : null };
    }
    setLocal((current) => {
      const sending = new Set(current.sending);
      sending.delete(rowKey);
      const refused = new Map(current.refused);
      const settled = new Map(current.settled);
      if (outcome.ok) {
        if (change.kind !== "remove") {
          const at = Date.now();
          settled.set(rowKey, { at, line: impactLine(impact) });
          setClock(at);
        }
      } else {
        refused.set(rowKey, refusalWords(outcome.code, scope, change.key, outcome.message));
      }
      return { sending, refused, settled };
    });
    return outcome.ok;
  };

  const restart = (serviceId: string) => {
    setRestartingLocal((current) => new Set(current).add(serviceId));
    void props.onRestart(serviceId).finally(() =>
      setRestartingLocal((current) => {
        const next = new Set(current);
        next.delete(serviceId);
        return next;
      }),
    );
  };

  const openNotLive = (item: VaultNotLiveItem) => {
    const found = notLiveTarget(view, item);
    if (found === null || found.valueId === null) return;
    const scope = view.scopes.find((candidate) => candidate.id === found.scopeId);
    const value = scope?.values.find((candidate) => candidate.id === found.valueId);
    if (scope === undefined || value === undefined) return;
    setMode({ kind: "list" });
    setQuery("");
    setFilter(ALL);
    if (scope.editable) setOpenRow(vaultRowKey(scope.id, value.id));
    setFlash(vaultRowKey(scope.id, value.id));
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(`[data-vault-row="${CSS.escape(value.key)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  const pick = (next: VaultFilter) => {
    setFilter(next);
    setOpenRow(null);
    if (mode.kind !== "list") setMode({ kind: "list" });
  };

  const editing = mode.kind === "text" || mode.kind === "review";
  const runtime = view.scopes.filter((scope) => scope.kind === "runtime");
  const managed = view.scopes.filter((scope) => scope.kind === "managed");

  const header = (
    <div className="flex h-12 flex-none items-center gap-1 pr-2.5 pl-2" data-vault-header>
      <Menu>
        <MenuTrigger
          render={
            <Button
              className="min-w-0"
              disabled={view.status === "unread"}
              size="xs"
              variant="ghost"
            />
          }
        >
          <span className="truncate">{app?.hostname ?? "All apps"}</span>
          <ChevronDownIcon className="opacity-60" />
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-52">
          <MenuItem onClick={() => pick(ALL)}>
            <span className="grow">All apps</span>
            {filter.kind === "all" ? <CheckIcon className="size-3.5" /> : null}
          </MenuItem>
          {runtime.length > 0 ? <MenuSeparator /> : null}
          {runtime.map((scope) => (
            <MenuItem key={scope.id} onClick={() => pick({ kind: "app", id: scope.id })}>
              <span className="grow">Only {scope.hostname}</span>
              {filter.kind === "app" && filter.id === scope.id ? (
                <CheckIcon className="size-3.5" />
              ) : null}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      <span className="grow" />
      <span className="vault-find" data-open={findOpen ? "" : undefined}>
        <Input
          aria-label="Search"
          autoComplete="off"
          className="ml-0.5 w-[184px]"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              setFindOpen(false);
            }
          }}
          placeholder="Search"
          ref={findInput}
          size="sm"
          spellCheck={false}
          tabIndex={findOpen ? undefined : -1}
          value={query}
        />
      </span>
      <Tip tip={findOpen ? "Close search · Esc" : "Search"}>
        <Button
          aria-expanded={findOpen}
          aria-label={findOpen ? "Close search" : "Search"}
          onClick={() => {
            if (findOpen) {
              setQuery("");
              setFindOpen(false);
            } else {
              setFindOpen(true);
              requestAnimationFrame(() => findInput.current?.focus());
            }
          }}
          size="icon-xs"
          variant="ghost-muted"
        >
          {findOpen ? <XIcon /> : <SearchIcon />}
        </Button>
      </Tip>
      <Button
        disabled={target === undefined || !target.editable || editing || view.status === "unread"}
        onClick={() => {
          setOpenRow(null);
          setQuery("");
          setMode({ kind: "add" });
        }}
        size="xs"
        variant="outline"
      >
        <PlusIcon />
        Add
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label="More"
              disabled={view.status === "unread"}
              size="icon-xs"
              variant="ghost-muted"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-52">
          <MenuItem
            disabled={target === undefined || !target.editable || editing}
            onClick={() => {
              if (target === undefined) return;
              setOpenRow(null);
              setMode({ kind: "text", text: vaultToText(target) });
            }}
          >
            <TextIcon />
            Edit as text
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );

  if (view.status === "unread" || target === undefined) {
    return (
      <div className="vault-panel flex h-full min-h-0 flex-col bg-card" data-vault-panel="unread">
        {header}
        <div aria-busy="true" className="grid gap-0 pt-2" data-vault-skeleton>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div
              className="mx-2 grid h-9 grid-cols-[5fr_6fr] items-center gap-x-4 px-2.5"
              key={index}
            >
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const needs = vaultNeeds(vaultGroups(view, filter, ""));
  // A value the card on top takes a paste for is not listed again below it.
  const asked = new Set(q === "" ? needs.unset.map((entry) => entry.value.id) : []);
  const groups = vaultGroups(view, filter, q)
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => !asked.has(entry.value.id)),
    }))
    .filter((group) => group.entries.length > 0);
  const rowOf = (entry: VaultEntry) => {
    const rowKey = vaultRowKey(entry.scope.id, entry.value.id);
    return (
      <VaultRow
        activity={activityOf(entry.scope, entry.value.key)}
        actor={props.actor}
        flash={flash === rowKey}
        impactOf={(change) => props.impactOf(entry.scope.ref, change)}
        key={rowKey}
        label={entry.label}
        mateName={mateName}
        nowMs={nowMs}
        onRestart={(serviceId) => restart(serviceId)}
        onToggle={() => setOpenRow((current) => (current === rowKey ? null : rowKey))}
        onWrite={(change) => {
          void write(entry.scope, change).then((ok) => {
            if (ok) setOpenRow((current) => (current === rowKey ? null : current));
          });
        }}
        only={entry.only}
        open={openRow === rowKey}
        restarting={restarting}
        scope={entry.scope}
        value={entry.value}
        view={view}
      />
    );
  };

  const list = (): ReactNode => {
    if (mode.kind === "text") {
      return (
        <VaultTextEditor
          onCancel={() => setMode({ kind: "list" })}
          onChange={(text) => setMode({ kind: "text", text })}
          onReview={() =>
            setMode({
              kind: "review",
              text: mode.text,
              writes: diffVaultText(target, mode.text).writes,
            })
          }
          scope={target}
          text={mode.text}
        />
      );
    }
    if (mode.kind === "review") {
      return (
        <VaultReview
          applying={applying}
          impactOf={(change) => props.impactOf(target.ref, change)}
          mateName={props.actor === "mate" ? mateName : null}
          onApply={(writes) => {
            setApplying(true);
            void (async () => {
              for (const change of writes) await write(target, change);
              setApplying(false);
              setMode({ kind: "list" });
            })();
          }}
          onBack={() => setMode({ kind: "text", text: mode.text })}
          scope={target}
          writes={mode.writes}
        />
      );
    }
    const empty = groups.length === 0;
    return (
      <>
        {mode.kind === "add" ? (
          <VaultAddCard
            busy={[...local.sending].some((key) => key.startsWith(`${target.id}:`))}
            key={target.id}
            onAdd={(change) => {
              void write(target, change).then((ok) => {
                if (ok) setMode({ kind: "list" });
              });
            }}
            onCancel={() => setMode({ kind: "list" })}
            onPasteEnv={(pasted) =>
              setMode({ kind: "text", text: pasteIntoText(vaultToText(target), pasted) })
            }
            refusal={
              [...local.refused].find(([key]) => key.startsWith(`${target.id}:`))?.[1] ?? null
            }
            scope={target}
          />
        ) : null}
        {q === "" && mode.kind === "list" ? (
          <VaultNeedsYou
            busy={(entry) => activityOf(entry.scope, entry.value.key).kind === "busy"}
            mateName={mateName}
            needs={needs}
            onWrite={(entry, change) => write(entry.scope, change)}
          />
        ) : null}
        {groups.map((group) => (
          <section className="vault-group" data-vault-group={group.id} key={group.id}>
            <h3 className="px-4.5 pb-0.5 font-medium text-xs text-muted-foreground">
              {group.title}
            </h3>
            {group.entries.map(rowOf)}
          </section>
        ))}
        {filter.kind === "all" && managed.length > 0 && q === "" ? (
          <section className="vault-group" data-vault-group="zerops">
            <h3 className="px-4.5 pb-0.5 font-medium text-xs text-muted-foreground">
              Made by Zerops
            </h3>
            {managed.map((scope) => (
              <VaultManagedFold
                key={scope.id}
                onToggle={() => setOpenRow((current) => (current === scope.id ? null : scope.id))}
                open={openRow === scope.id}
                scope={scope}
              />
            ))}
          </section>
        ) : null}
        {empty && q !== "" ? (
          <p className="mx-4.5 my-3.5 text-line text-muted-foreground">Nothing matches “{q}”.</p>
        ) : empty && mode.kind !== "add" ? (
          <p className="mx-4.5 my-3.5 flex flex-wrap items-baseline gap-1.5 text-line text-muted-foreground">
            <span>
              {app === undefined ? "No values yet." : `${app.hostname} has no values of its own.`}
            </span>
            {target.editable ? (
              <InlineButton onClick={() => setMode({ kind: "add" })}>Add one</InlineButton>
            ) : null}
          </p>
        ) : null}
        {app !== undefined && app.kind === "runtime" && q === "" ? (
          <VaultReads
            onGoto={(scopeId, key) => {
              const scope = view.scopes.find((candidate) => candidate.id === scopeId);
              const value = scope?.values.find((candidate) => candidate.key === key);
              if (scope === undefined || value === undefined) return;
              pick(scope.kind === "shared" ? ALL : { kind: "app", id: scope.id });
              setOpenRow(vaultRowKey(scope.id, value.id));
            }}
            scope={app}
            view={view}
          />
        ) : null}
      </>
    );
  };

  return (
    <div
      className="vault-panel flex h-full min-h-0 flex-col bg-card"
      data-vault-panel={view.status}
    >
      {header}
      <div
        className={
          scrolled
            ? "min-h-0 flex-1 overflow-y-auto border-t border-border/60 pt-1 pb-11 [scrollbar-width:thin]"
            : "min-h-0 flex-1 overflow-y-auto border-t border-transparent pt-1 pb-11 [scrollbar-width:thin]"
        }
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        ref={scroller}
      >
        {view.status === "failed" ? (
          <p
            className="mx-4.5 mb-2.5 text-line text-muted-foreground"
            data-vault-failed
            role="alert"
          >
            Couldn't read the vault
          </p>
        ) : null}
        <VaultNotLive
          actor={props.actor}
          items={view.notLive.filter((item) => item.kind === "restart")}
          mate={props.who.kind === "mate" ? props.who : null}
          monograms={new Map()}
          onOpen={openNotLive}
          onRestart={(serviceId) => restart(serviceId)}
          restarting={restarting}
        />
        <div data-vault-list={filter.kind === "all" ? "all" : filter.id}>{list()}</div>
      </div>
    </div>
  );
}

function Tip({ tip, children }: { readonly tip: string; readonly children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup>{tip}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * What needs the person, on top: the values not set yet, each taking a paste right here (a name
 * that says secret is saved secret), and the secrets written readable, made secret in one press.
 */
function VaultNeedsYou(props: {
  readonly needs: ReturnType<typeof vaultNeeds>;
  readonly mateName: string | null;
  readonly busy: (entry: VaultEntry) => boolean;
  readonly onWrite: (entry: VaultEntry, change: VaultWrite) => Promise<boolean>;
}) {
  const { unset, readable } = props.needs;
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  if (unset.length === 0 && readable.length === 0) return null;
  const filled = unset.filter((entry) => (drafts.get(entry.value.id) ?? "") !== "");

  const saveAll = async () => {
    setSaving(true);
    for (const entry of filled) {
      await props.onWrite(entry, {
        kind: "update",
        id: entry.value.id,
        key: entry.value.key,
        value: drafts.get(entry.value.id) ?? "",
        sensitive: looksSecret(entry.value.key),
      });
    }
    setDrafts(new Map());
    setSaving(false);
  };
  const lockAll = async () => {
    setLocking(true);
    for (const entry of readable) {
      await props.onWrite(entry, {
        kind: "update",
        id: entry.value.id,
        key: entry.value.key,
        value: entry.value.value ?? "",
        sensitive: true,
      });
    }
    setLocking(false);
  };

  return (
    <div className="grid gap-2 px-3 pt-1 pb-2">
      {unset.length > 0 ? (
        <section
          className="vault-card rounded-xl bg-card px-3.5 pt-3 pb-3"
          data-vault-needs="unset"
        >
          <h3 className="flex items-center gap-1.5 font-medium text-line text-foreground">
            <KeyRoundIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {unsetTitle(unset)}
          </h3>
          <p className="mt-0.5 text-xs leading-4.5 text-muted-foreground">
            Paste {unset.length === 1 ? "it" : "them"} here.{" "}
            {props.mateName === null
              ? "Your apps get them after a restart."
              : `${props.mateName} puts them to work with your next message.`}
          </p>
          <div className="mt-2.5 grid gap-1.5">
            {unset.map((entry) => {
              const secret = looksSecret(entry.value.key);
              return (
                <label
                  className="grid grid-cols-[minmax(0,4fr)_minmax(0,7fr)] items-center gap-x-3"
                  key={entry.value.id}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-line text-foreground">
                    <span className="truncate">{entry.label}</span>
                    {secret ? (
                      <LockIcon
                        aria-label="Saved secret"
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </span>
                  <Input
                    aria-label={entry.label}
                    autoComplete="off"
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setDrafts((current) => new Map(current).set(entry.value.id, next));
                    }}
                    placeholder="Paste here"
                    size="sm"
                    spellCheck={false}
                    type={secret ? "password" : "text"}
                    value={drafts.get(entry.value.id) ?? ""}
                  />
                </label>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            {unset.some((entry) => looksSecret(entry.value.key)) ? (
              <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <LockIcon aria-hidden="true" className="size-3" />
                Saved secret: nobody reads it back
              </span>
            ) : null}
            <Button
              disabled={filled.length === 0 || saving || unset.some(props.busy)}
              onClick={() => void saveAll()}
              size="xs"
            >
              {saving ? <Spinner size="xs" /> : null}
              {filled.length > 1 ? `Save ${filled.length}` : "Save"}
            </Button>
          </div>
        </section>
      ) : null}
      {readable.length > 0 ? (
        <section
          className="flex items-start gap-3 rounded-xl bg-muted/50 px-3.5 py-3"
          data-vault-needs="readable"
        >
          <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="grid min-w-0 grow gap-0.5">
            <p className="text-line text-foreground">
              {joinNames(readable.map((entry) => entry.label))}{" "}
              {readable.length === 1 ? "is" : "are"} readable by anyone who opens this environment
            </p>
            <p className="text-xs leading-4.5 text-muted-foreground">
              Make {readable.length === 1 ? "it" : "them"} secret: nobody can read{" "}
              {readable.length === 1 ? "it" : "them"} back, and your apps still get{" "}
              {readable.length === 1 ? "it" : "them"}.
            </p>
          </div>
          <Button
            className="shrink-0"
            disabled={locking || readable.some(props.busy)}
            onClick={() => void lockAll()}
            size="xs"
            variant="outline"
          >
            {locking ? <Spinner size="xs" /> : null}
            Make secret
          </Button>
        </section>
      ) : null}
    </div>
  );
}
