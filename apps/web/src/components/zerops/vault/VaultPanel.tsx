/**
 * The Vault tab: one environment's values beside a Mate's conversation, for people as much as for
 * developers. Two views, switched at the top. Values: what needs the person first (values not
 * set, secrets anyone can read, changes not live yet), then the environment's values in cards
 * named for what each is for (Admin sign-in, Stripe, Email, Addresses…), each value on one line
 * under its name in words. Apps: the environment's apps, and the services Zerops runs for it, in
 * words ("Node.js app", "Database · PostgreSQL"); each opens its own page — its own values and
 * what it reads from its deploy config, linked to the file. Edit as text sits behind the "⋯".
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
  ActivityIcon,
  ArchiveIcon,
  BoxIcon,
  BoxesIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CreditCardIcon,
  DatabaseIcon,
  EllipsisIcon,
  FileCodeIcon,
  GlobeIcon,
  HardDriveIcon,
  KeyRoundIcon,
  LockIcon,
  MailIcon,
  MessagesSquareIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TextIcon,
  UserRoundIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, InlineButton } from "../../ui/button";
import { Input } from "../../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Skeleton } from "../../ui/skeleton";
import { Spinner } from "../../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { impactLine, joinNames, notLiveTarget, refusalWords, vaultRowKey } from "./vault.logic";
import { VaultAddCard, VaultReview, VaultTextEditor } from "./VaultEditors";
import {
  looksSecret,
  serviceWords,
  unsetTitle,
  vaultGroups,
  vaultNeeds,
  type VaultEntry,
  type VaultFilter,
  type VaultGroupKind,
  type VaultServiceKind,
} from "./vaultGroups.logic";
import { VaultNotLive } from "./VaultNotLive";
import {
  VaultBox,
  VaultManagedRows,
  VaultReadRows,
  VaultRow,
  type VaultRowActivity,
} from "./VaultRow";
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

const GROUP_ICON: Readonly<Record<VaultGroupKind, LucideIcon>> = {
  admin: UserRoundIcon,
  email: MailIcon,
  storage: HardDriveIcon,
  addresses: GlobeIcon,
  data: DatabaseIcon,
  security: ShieldIcon,
  payments: CreditCardIcon,
  ai: SparklesIcon,
  search: SearchIcon,
  monitoring: ActivityIcon,
  service: PlugIcon,
  app: BoxIcon,
  other: SlidersHorizontalIcon,
};

const SERVICE_ICON: Readonly<Record<VaultServiceKind, LucideIcon>> = {
  app: BoxIcon,
  database: DatabaseIcon,
  cache: ZapIcon,
  search: SearchIcon,
  storage: ArchiveIcon,
  messaging: MessagesSquareIcon,
};

type Page =
  | { readonly kind: "values" }
  | { readonly kind: "apps" }
  | { readonly kind: "app"; readonly id: string };

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
  const [page, setPage] = useState<Page>({ kind: "values" });
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [applying, setApplying] = useState(false);
  const [local, setLocal] = useState<Local>(EMPTY_LOCAL);
  const [restartingLocal, setRestartingLocal] = useState<ReadonlySet<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [scrolled, setScrolled] = useState(false);

  const shared = view.scopes.find((candidate) => candidate.kind === "shared");
  const app =
    page.kind === "app" ? view.scopes.find((candidate) => candidate.id === page.id) : undefined;
  // Where Add and Edit as text write: the app open, else the whole environment.
  const target = app ?? shared;
  const mateName = props.who.kind === "mate" ? props.who.name : null;
  const restarting = new Set([...props.restarting, ...restartingLocal]);
  const q = page.kind === "app" ? "" : query.trim();

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

  /** Opens a value where it lives: Values for the environment's, its app's page else. */
  const reveal = (scope: VaultScope, valueId: string, key: string) => {
    go(scope.kind === "shared" ? { kind: "values" } : { kind: "app", id: scope.id });
    setQuery("");
    setSearching(false);
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
  const canWrite =
    target !== undefined && target.editable && view.status !== "unread" && page.kind !== "apps";
  const runtime = view.scopes.filter((scope) => scope.kind === "runtime");
  const managed = view.scopes.filter((scope) => scope.kind === "managed");

  const actions = (
    <>
      {page.kind === "app" ? null : (
        <Tip tip={searching ? "Close search · Esc" : "Search"}>
          <Button
            aria-expanded={searching}
            aria-label={searching ? "Close search" : "Search"}
            disabled={view.status === "unread"}
            onClick={() => {
              if (searching) {
                setQuery("");
                setSearching(false);
              } else {
                setSearching(true);
                requestAnimationFrame(() => searchInput.current?.focus());
              }
            }}
            size="icon-xs"
            variant="ghost-muted"
          >
            {searching ? <XIcon /> : <SearchIcon />}
          </Button>
        </Tip>
      )}
      {canWrite ? (
        <Button
          disabled={editing}
          onClick={() => {
            setOpenRow(null);
            setQuery("");
            setSearching(false);
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

  const header = (
    <div className="flex-none" data-vault-header>
      <div className="flex h-12 items-center gap-1.5 pr-2.5 pl-3">
        {app === undefined ? (
          <div aria-label="Show" className="vault-switch" role="tablist">
            {(
              [
                ["values", "Values"],
                ["apps", "Apps"],
              ] as const
            ).map(([kind, words]) => (
              <button
                aria-selected={page.kind === kind}
                className="vault-switch-item"
                data-vault-view={kind}
                disabled={view.status === "unread"}
                key={kind}
                onClick={() => go({ kind })}
                role="tab"
                type="button"
              >
                {words}
              </button>
            ))}
          </div>
        ) : (
          <>
            <Button
              aria-label="Back to apps"
              onClick={() => go({ kind: "apps" })}
              size="icon-xs"
              variant="ghost-muted"
            >
              <ChevronLeftIcon />
            </Button>
            <span className="truncate font-semibold text-line text-foreground">{app.hostname}</span>
            {serviceWords(app).words === null ? null : (
              <span className="truncate text-xs text-muted-foreground">
                {serviceWords(app).words}
              </span>
            )}
          </>
        )}
        <span className="grow" />
        {actions}
      </div>
      {searching && page.kind !== "app" ? (
        <div className="px-3 pb-2.5">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search"
              autoComplete="off"
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
              placeholder={page.kind === "apps" ? "Search apps" : "Search values"}
              ref={searchInput}
              size="sm"
              spellCheck={false}
              value={query}
            />
          </InputGroup>
        </div>
      ) : null}
    </div>
  );

  if (view.status === "unread" || target === undefined) {
    return (
      <div className="vault-panel flex h-full min-h-0 flex-col bg-card" data-vault-panel="unread">
        {header}
        <div aria-busy="true" className="vault-canvas min-h-0 flex-1 p-3" data-vault-skeleton>
          <div className="vault-box">
            {[0, 1, 2, 3, 4].map((index) => (
              <div className="flex h-11 items-center justify-between px-3.5" key={index}>
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-40" />
              </div>
            ))}
          </div>
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

  const boxesOf = (filter: VaultFilter, skip: ReadonlySet<string>) =>
    vaultGroups(view, filter, q)
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => !skip.has(entry.value.id)),
      }))
      .filter((group) => group.entries.length > 0)
      .map((group) => (
        <VaultBox icon={GROUP_ICON[group.kind]} id={group.id} key={group.id} title={group.title}>
          {group.entries.map(rowOf)}
        </VaultBox>
      ));

  const valuesPage = (): ReactNode => {
    const needs = vaultNeeds(vaultGroups(view, EVERYTHING, ""));
    // A value the card on top takes a paste for is not listed again below it.
    const asked = new Set(q === "" ? needs.unset.map((entry) => entry.value.id) : []);
    const boxes = boxesOf(q === "" ? MAIN : EVERYTHING, asked);
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
        {boxes}
        {boxes.length === 0 && q !== "" ? (
          <p className="px-1 py-2 text-line text-muted-foreground">Nothing matches “{q}”.</p>
        ) : boxes.length === 0 && mode.kind === "list" ? (
          <p className="flex flex-wrap items-baseline gap-1.5 px-1 py-2 text-line text-muted-foreground">
            <span>No values yet.</span>
            <InlineButton onClick={() => setMode({ kind: "add" })}>Add one</InlineButton>
          </p>
        ) : null}
      </>
    );
  };

  const appsPage = (): ReactNode => {
    const needle = q.toLowerCase();
    const matches = (scope: VaultScope) =>
      needle === "" ||
      `${scope.hostname ?? ""} ${serviceWords(scope).words ?? ""}`.toLowerCase().includes(needle);
    const apps = runtime.filter(matches);
    const services = managed.filter(matches);
    return (
      <>
        {apps.length > 0 ? (
          <VaultBox icon={BoxesIcon} id="apps" title="Your apps">
            {apps.map((scope) => (
              <VaultAppRow
                key={scope.id}
                onOpen={() => go({ kind: "app", id: scope.id })}
                scope={scope}
                view={view}
              />
            ))}
          </VaultBox>
        ) : null}
        {services.length > 0 ? (
          <VaultBox icon={DatabaseIcon} id="zerops" title="Run by Zerops">
            {services.map((scope) => (
              <VaultAppRow
                key={scope.id}
                onOpen={() => go({ kind: "app", id: scope.id })}
                scope={scope}
                view={view}
              />
            ))}
          </VaultBox>
        ) : null}
        {apps.length === 0 && services.length === 0 ? (
          <p className="px-1 py-2 text-line text-muted-foreground">
            {q === "" ? "No apps yet." : `No app matches “${q}”.`}
          </p>
        ) : null}
      </>
    );
  };

  const appPage = (scope: VaultScope): ReactNode => {
    if (scope.kind === "managed") {
      return (
        <VaultBox
          aside={<span className="text-xs text-muted-foreground">read only</span>}
          icon={SERVICE_ICON[serviceWords(scope).kind]}
          id="made"
          title="Made by Zerops"
        >
          <VaultManagedRows scope={scope} />
        </VaultBox>
      );
    }
    const entries = vaultGroups(view, { kind: "app", id: scope.id }, "").flatMap(
      (group) => group.entries,
    );
    const config = props.renderDeployConfig?.(scope.hostname ?? "");
    return (
      <>
        <VaultBox icon={KeyRoundIcon} id="own" title="Its own values">
          {entries.length > 0 ? (
            entries.map(rowOf)
          ) : (
            <p className="flex flex-wrap items-baseline gap-1.5 px-3.5 py-3 text-line text-muted-foreground">
              <span>Nothing of its own yet.</span>
              {mode.kind === "list" ? (
                <InlineButton onClick={() => setMode({ kind: "add" })}>Add one</InlineButton>
              ) : null}
            </p>
          )}
        </VaultBox>
        <VaultBox
          aside={config}
          icon={FileCodeIcon}
          id="reads"
          title="What it reads from the deploy config"
        >
          <VaultReadRows
            onGoto={(scopeId, key) => {
              const owner = view.scopes.find((candidate) => candidate.id === scopeId);
              const value = owner?.values.find((candidate) => candidate.key === key);
              if (owner === undefined || value === undefined) return;
              reveal(owner, value.id, value.key);
            }}
            scope={scope}
            view={view}
          />
        </VaultBox>
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
        {app !== undefined ? appPage(app) : page.kind === "apps" ? appsPage() : valuesPage()}
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
            ? "vault-canvas min-h-0 flex-1 overflow-y-auto border-t border-border/70 [scrollbar-width:thin]"
            : "vault-canvas min-h-0 flex-1 overflow-y-auto border-t border-transparent [scrollbar-width:thin]"
        }
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        ref={scroller}
      >
        <div className="grid gap-3 px-3 pt-1 pb-12" data-vault-list={app?.id ?? page.kind}>
          {view.status === "failed" ? (
            <p className="px-1 text-line text-muted-foreground" data-vault-failed role="alert">
              Couldn't read the vault
            </p>
          ) : null}
          {page.kind === "values" ? (
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
          {list()}
        </div>
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

/** One app, or a service Zerops runs: its name, what it is in words, and what it has of its own. */
function VaultAppRow(props: {
  readonly scope: VaultScope;
  readonly view: VaultView;
  readonly onOpen: () => void;
}) {
  const { scope } = props;
  const { kind, words } = serviceWords(scope);
  const Icon = SERVICE_ICON[kind];
  const own = scope.kind === "managed" ? 0 : scope.values.length;
  const stale = props.view.scopes.some((owner) =>
    owner.values.some((value) =>
      value.readers.some((reader) => reader.serviceId === scope.id && reader.state === "restart"),
    ),
  );
  return (
    <div className="vault-row" data-vault-app={scope.hostname}>
      <button
        className="flex h-12 w-full items-center gap-3 px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={props.onOpen}
        type="button"
      >
        <span className="vault-app-icon grid size-7 shrink-0 place-items-center rounded-lg">
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="grid min-w-0 gap-px">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-line text-foreground">{scope.hostname}</span>
            {stale ? (
              <span
                aria-label="Runs an old value"
                className="size-1.5 shrink-0 rounded-full bg-warning"
                role="img"
              />
            ) : null}
          </span>
          {words === null ? null : (
            <span className="truncate text-xs text-muted-foreground">{words}</span>
          )}
        </span>
        <span className="grow" />
        {own > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {own} {own === 1 ? "value" : "values"}
          </span>
        ) : null}
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
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
    <>
      {unset.length > 0 ? (
        <section className="vault-callout" data-tone="attention" data-vault-needs="unset">
          <div className="flex items-start gap-3">
            <span className="vault-callout-icon">
              <KeyRoundIcon aria-hidden="true" className="size-4" />
            </span>
            <div className="grid min-w-0 gap-0.5">
              <h3 className="font-semibold text-line text-foreground">{unsetTitle(unset)}</h3>
              <p className="text-xs leading-4.5 text-muted-foreground">
                Paste {unset.length === 1 ? "it" : "them"} here.{" "}
                {props.mateName === null
                  ? "Your apps get them after a restart."
                  : `${props.mateName} puts them to work with your next message.`}
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            {unset.map((entry) => {
              const secret = looksSecret(entry.value.key);
              return (
                <label className="grid gap-1" key={entry.value.id}>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                    <span className="truncate">{entry.label}</span>
                    {entry.only === null ? null : (
                      <span className="vault-only shrink-0 truncate font-normal text-muted-foreground">
                        only {entry.only}
                      </span>
                    )}
                    {secret ? (
                      <span className="flex shrink-0 items-center gap-1 font-normal text-muted-foreground">
                        <LockIcon aria-hidden="true" className="size-3" />
                        saved secret
                      </span>
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
          <div className="mt-3 flex justify-end">
            <Button
              disabled={filled.length === 0 || saving || unset.some(props.busy)}
              onClick={() => void saveAll()}
              size="sm"
            >
              {saving ? <Spinner size="xs" /> : null}
              {filled.length > 1 ? `Save ${filled.length}` : "Save"}
            </Button>
          </div>
        </section>
      ) : null}
      {readable.length > 0 ? (
        <section className="vault-callout" data-tone="advice" data-vault-needs="readable">
          <div className="flex items-start gap-3">
            <span className="vault-callout-icon">
              <ShieldIcon aria-hidden="true" className="size-4" />
            </span>
            <div className="grid min-w-0 grow gap-0.5">
              <h3 className="font-semibold text-line text-foreground">
                {readable.length === 1
                  ? "A secret isn't protected"
                  : `${readable.length} secrets aren't protected`}
              </h3>
              <p className="text-xs leading-4.5 text-muted-foreground">
                Anyone with access can read {joinNames(readable.map((entry) => entry.label))}. Make{" "}
                {readable.length === 1 ? "it" : "them"} secret — your apps still get{" "}
                {readable.length === 1 ? "it" : "them"}.
              </p>
            </div>
            <Button
              className="shrink-0"
              disabled={locking || readable.some(props.busy)}
              onClick={() => void lockAll()}
              size="sm"
              variant="outline"
            >
              {locking ? <Spinner size="xs" /> : <LockIcon />}
              Make secret
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
