/**
 * The Vault tab: one environment's values beside a Mate's conversation, for people as much as for
 * developers. The main page holds what needs the person on top (values not set, secrets anyone can
 * read, changes not live yet), the environment's apps, then the values every app gets in groups
 * named for what each is for (Admin sign-in, Stripe, Email, Addresses…), each on one line under
 * its name in words. An app opens its own page: its own values, and what it reads from its deploy
 * config, linked to the file. Edit as text sits behind the "⋯".
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
  BoxIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DatabaseIcon,
  EllipsisIcon,
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  TextIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, InlineButton } from "../../ui/button";
import { Input } from "../../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Skeleton } from "../../ui/skeleton";
import { Spinner } from "../../ui/spinner";
import { impactLine, joinNames, notLiveTarget, refusalWords, vaultRowKey } from "./vault.logic";
import { VaultAddCard, VaultReview, VaultTextEditor } from "./VaultEditors";
import {
  looksSecret,
  unsetTitle,
  vaultGroups,
  vaultNeeds,
  typeWord,
  type VaultEntry,
  type VaultFilter,
} from "./vaultGroups.logic";
import { VaultNotLive } from "./VaultNotLive";
import { VaultManagedValues, VaultReads, VaultRow, type VaultRowActivity } from "./VaultRow";
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
  /** A link to an app's deploy config, drawn by whoever knows the workspace; none without one. */
  readonly renderDeployConfig?: (hostname: string) => ReactNode;
  /** The clock relative times are read against; now when absent. */
  readonly nowMs?: number;
}

const SETTLE_MS = 1400;
const IMPACT_MS = 8000;
const FLASH_MS = 1500;
const MAIN: VaultFilter = { kind: "all" };
const EVERYTHING: VaultFilter = { kind: "everything" };

type Page = { readonly kind: "all" } | { readonly kind: "app"; readonly id: string };

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
  const [page, setPage] = useState<Page>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [applying, setApplying] = useState(false);
  const [local, setLocal] = useState<Local>(EMPTY_LOCAL);
  const [restartingLocal, setRestartingLocal] = useState<ReadonlySet<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  const shared = view.scopes.find((candidate) => candidate.kind === "shared");
  const app =
    page.kind === "app" ? view.scopes.find((candidate) => candidate.id === page.id) : undefined;
  // Where Add and Edit as text write: the app open, else the whole environment.
  const target = app ?? shared;
  const mateName = props.who.kind === "mate" ? props.who.name : null;
  const restarting = new Set([...props.restarting, ...restartingLocal]);
  const q = page.kind === "all" ? query.trim() : "";

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

  const go = (next: Page) => {
    setPage(next);
    setOpenRow(null);
    setMode({ kind: "list" });
    scroller.current?.scrollTo({ top: 0 });
  };

  /** Opens a value where it lives: the main page for the environment's, its app's page else. */
  const reveal = (scope: VaultScope, valueId: string, key: string) => {
    go(scope.kind === "shared" ? { kind: "all" } : { kind: "app", id: scope.id });
    setQuery("");
    const rowKey = vaultRowKey(scope.id, valueId);
    if (scope.editable) setOpenRow(rowKey);
    setFlash(rowKey);
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(`[data-vault-row="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  const openNotLive = (item: VaultNotLiveItem) => {
    const found = notLiveTarget(view, item);
    if (found === null || found.valueId === null) return;
    const scope = view.scopes.find((candidate) => candidate.id === found.scopeId);
    const value = scope?.values.find((candidate) => candidate.id === found.valueId);
    if (scope === undefined || value === undefined) return;
    reveal(scope, value.id, value.key);
  };

  const editing = mode.kind === "text" || mode.kind === "review";
  const canWrite = target !== undefined && target.editable && view.status !== "unread";
  const apps = view.scopes.filter((scope) => scope.kind !== "shared");

  const actions = (
    <>
      {canWrite ? (
        <Button
          disabled={editing}
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
      ) : null}
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
            disabled={!canWrite || editing}
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
    </>
  );

  const header =
    app === undefined ? (
      <div className="flex h-12 flex-none items-center gap-1.5 pr-2.5 pl-3" data-vault-header>
        <InputGroup className="max-w-60 min-w-0 flex-1">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search"
            autoComplete="off"
            disabled={view.status === "unread"}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Search"
            size="sm"
            spellCheck={false}
            value={query}
          />
        </InputGroup>
        <span className="grow" />
        {actions}
      </div>
    ) : (
      <div className="flex h-12 flex-none items-center gap-1 pr-2.5 pl-2" data-vault-header>
        <Button
          aria-label="Back to all values"
          onClick={() => go({ kind: "all" })}
          size="icon-xs"
          variant="ghost-muted"
        >
          <ChevronLeftIcon />
        </Button>
        <span className="truncate font-medium text-line text-foreground">{app.hostname}</span>
        {app.serviceType === null ? null : (
          <span className="truncate text-xs text-muted-foreground">
            {typeWord(app.serviceType)}
          </span>
        )}
        <span className="grow" />
        {actions}
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

  const groupsOf = (filter: VaultFilter, skip: ReadonlySet<string>) =>
    vaultGroups(view, filter, q)
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => !skip.has(entry.value.id)),
      }))
      .filter((group) => group.entries.length > 0)
      .map((group) => (
        <section className="vault-group" data-vault-group={group.id} key={group.id}>
          <h3 className="px-4.5 pb-0.5 font-medium text-xs text-muted-foreground">{group.title}</h3>
          {group.entries.map(rowOf)}
        </section>
      ));

  const mainPage = (): ReactNode => {
    const needs = vaultNeeds(vaultGroups(view, EVERYTHING, ""));
    // A value the card on top takes a paste for is not listed again below it.
    const asked = new Set(q === "" ? needs.unset.map((entry) => entry.value.id) : []);
    const groups = groupsOf(q === "" ? MAIN : EVERYTHING, asked);
    const needle = q.toLowerCase();
    const shownApps = apps.filter(
      (scope) => q === "" || (scope.hostname ?? "").toLowerCase().includes(needle),
    );
    return (
      <>
        {q === "" && mode.kind === "list" ? (
          <VaultNeedsYou
            busy={(entry) => activityOf(entry.scope, entry.value.key).kind === "busy"}
            mateName={mateName}
            needs={needs}
            onWrite={(entry, change) => write(entry.scope, change)}
          />
        ) : null}
        {shownApps.length > 0 ? (
          <section className="vault-group" data-vault-group="apps">
            <h2 className="mx-4.5 pb-1 font-semibold text-line text-foreground">Apps</h2>
            {shownApps.map((scope) => (
              <VaultAppRow
                key={scope.id}
                onOpen={() => go({ kind: "app", id: scope.id })}
                scope={scope}
                stale={view.scopes.some((owner) =>
                  owner.values.some((value) =>
                    value.readers.some(
                      (reader) => reader.serviceId === scope.id && reader.state === "restart",
                    ),
                  ),
                )}
              />
            ))}
          </section>
        ) : null}
        {groups.length > 0 && q === "" ? (
          <h2 className="vault-section-title mx-4.5 font-semibold text-line text-foreground">
            Values
          </h2>
        ) : null}
        {groups}
        {groups.length === 0 && shownApps.length === 0 && q !== "" ? (
          <p className="mx-4.5 my-3.5 text-line text-muted-foreground">Nothing matches “{q}”.</p>
        ) : null}
      </>
    );
  };

  const appPage = (scope: VaultScope): ReactNode => {
    if (scope.kind === "managed") return <VaultManagedValues scope={scope} />;
    const groups = groupsOf({ kind: "app", id: scope.id }, new Set());
    return (
      <>
        {groups.length > 0 ? (
          <h2 className="mx-4.5 mt-1 font-semibold text-line text-foreground">Its own values</h2>
        ) : mode.kind === "list" ? (
          <p className="mx-4.5 mt-2 flex flex-wrap items-baseline gap-1.5 text-line text-muted-foreground">
            <span>{scope.hostname} has no values of its own.</span>
            <InlineButton onClick={() => setMode({ kind: "add" })}>Add one</InlineButton>
          </p>
        ) : null}
        {groups}
        <VaultReads
          config={props.renderDeployConfig?.(scope.hostname ?? "")}
          onGoto={(scopeId, key) => {
            const owner = view.scopes.find((candidate) => candidate.id === scopeId);
            const value = owner?.values.find((candidate) => candidate.key === key);
            if (owner === undefined || value === undefined) return;
            reveal(owner, value.id, value.key);
          }}
          scope={scope}
          view={view}
        />
      </>
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
        {app === undefined ? mainPage() : appPage(app)}
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
        {app === undefined ? (
          <VaultNotLive
            actor={props.actor}
            items={view.notLive.filter((item) => item.kind === "restart")}
            mate={props.who.kind === "mate" ? props.who : null}
            monograms={new Map()}
            onOpen={openNotLive}
            onRestart={(serviceId) => restart(serviceId)}
            restarting={restarting}
          />
        ) : null}
        <div data-vault-list={app === undefined ? "all" : app.id}>{list()}</div>
      </div>
    </div>
  );
}

/** One app on the main page: its name and kind, what it has of its own; it opens the app's page. */
function VaultAppRow(props: {
  readonly scope: VaultScope;
  readonly stale: boolean;
  readonly onOpen: () => void;
}) {
  const { scope } = props;
  const own = scope.values.length;
  return (
    <div className="vault-row mx-2" data-vault-app={scope.hostname}>
      <button
        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={props.onOpen}
        type="button"
      >
        {scope.kind === "managed" ? (
          <DatabaseIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <BoxIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-line text-foreground">{scope.hostname}</span>
        {scope.serviceType === null ? null : (
          <span className="truncate text-xs text-muted-foreground">
            {typeWord(scope.serviceType)}
          </span>
        )}
        {props.stale ? (
          <span
            aria-label="Runs an old value"
            className="size-1.5 shrink-0 rounded-full bg-warning"
            role="img"
          />
        ) : null}
        <span className="grow" />
        <span className="shrink-0 text-xs text-muted-foreground">
          {scope.kind === "managed" ? "made by Zerops" : own === 0 ? "" : `${own} of its own`}
        </span>
        <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </div>
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
                    {entry.only === null ? null : (
                      <span className="vault-only shrink-0 truncate text-2xs text-muted-foreground">
                        only {entry.only}
                      </span>
                    )}
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
