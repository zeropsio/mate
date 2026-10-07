/**
 * The Vault tab: one Zerops project's variables beside a Mate's conversation, in the owner's
 * "Quiet" look — the environment in the header with search, Edit as text and Add; a segmented bar
 * of scopes (Shared, then each service by hostname); what is not live yet; then the scope's
 * values, plain then sensitive, each a two-line row that opens in place.
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
import { DatabaseIcon, LockIcon, PlusIcon, SearchIcon, TextIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button, InlineButton } from "../../ui/button";
import { Input } from "../../ui/input";
import { Skeleton } from "../../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateFace } from "../primitives";
import {
  impactLine,
  notLiveTarget,
  refusalWords,
  scopeCount,
  scopeName,
  scopeSections,
  serviceMonograms,
  vaultRowKey,
} from "./vault.logic";
import { VaultAddCard, VaultReview, VaultTextEditor } from "./VaultEditors";
import { VaultNotLive } from "./VaultNotLive";
import { VaultManagedRow, VaultReads, VaultRow, type VaultRowActivity } from "./VaultRow";
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
  const [scopeId, setScopeId] = useState<string>("shared");
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

  const scope = view.scopes.find((candidate) => candidate.id === scopeId) ?? view.scopes[0];
  const monograms = serviceMonograms(
    view.scopes.flatMap((candidate) => (candidate.hostname === null ? [] : [candidate.hostname])),
  );
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

  // Relative times ("set 2 days ago") move on by the minute.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const activityOf = (target: VaultScope, key: string): VaultRowActivity => {
    const rowKey = vaultRowKey(target.id, key);
    const pending = props.pending.get(rowKey);
    if (local.sending.has(rowKey) || pending?.kind === "saving" || pending?.kind === "removing") {
      return { kind: "busy" };
    }
    const refusedHere = local.refused.get(rowKey);
    if (refusedHere !== undefined) return { kind: "refused", reason: refusedHere };
    if (pending?.kind === "refused") {
      return {
        kind: "refused",
        reason: refusalWords(pending.code, target, key, pending.message),
      };
    }
    const settled = local.settled.get(rowKey);
    if (settled !== undefined) {
      return { kind: "settled", line: settled.line, check: nowMs - settled.at < SETTLE_MS };
    }
    return { kind: "idle" };
  };

  const write = async (target: VaultScope, change: VaultWrite): Promise<boolean> => {
    const rowKey = vaultRowKey(target.id, change.key);
    const impact = props.impactOf(target.ref, change);
    setLocal((current) => {
      const refused = new Map(current.refused);
      refused.delete(rowKey);
      return { ...current, sending: new Set(current.sending).add(rowKey), refused };
    });
    let outcome: VaultWriteOutcome;
    try {
      outcome = await props.onWrite(target.ref, change);
    } catch (cause) {
      outcome = {
        ok: false,
        code: null,
        message: cause instanceof Error ? cause.message : null,
      };
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
        refused.set(rowKey, refusalWords(outcome.code, target, change.key, outcome.message));
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

  const goto = (targetScopeId: string, key: string | null, valueId: string | null) => {
    setScopeId(targetScopeId);
    setMode({ kind: "list" });
    setQuery("");
    const target = view.scopes.find((candidate) => candidate.id === targetScopeId);
    const value =
      target?.values.find((candidate) => candidate.id === valueId) ??
      target?.values.find((candidate) => candidate.key === key);
    if (value === undefined || target === undefined) return;
    if (target.editable) setOpenRow(value.id);
    setFlash(value.id);
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(`[data-vault-row="${CSS.escape(value.key)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  const openNotLive = (item: VaultNotLiveItem) => {
    const target = notLiveTarget(view, item);
    if (target === null) return;
    if (target.valueId === null) {
      setScopeId(target.scopeId);
      setMode({ kind: "list" });
      setOpenRow(null);
      return;
    }
    goto(target.scopeId, null, target.valueId);
  };

  const pickScope = (id: string) => {
    setScopeId(id);
    setOpenRow(null);
    if (mode.kind !== "list") setMode({ kind: "list" });
  };

  const editing = mode.kind === "text" || mode.kind === "review";
  const readOnly = scope === undefined || !scope.editable;

  const header = (
    <div className="flex h-12 flex-none items-center gap-0.5 pr-3 pl-2.5" data-vault-header>
      <div className="flex h-[30px] min-w-0 items-center gap-1.75 px-1.5 font-medium text-line">
        {props.who.kind === "mate" ? (
          <MateFace
            className="size-4"
            shape={props.who.shape}
            size="dot"
            state="idle"
            tint={props.who.tint}
          />
        ) : null}
        <span className="truncate">{props.who.name}</span>
      </div>
      <span className="grow" />
      <div className="flex items-center">
        <span className="vault-find" data-open={findOpen ? "" : undefined}>
          <Input
            aria-label="Search keys and values"
            autoComplete="off"
            className="ml-0.5 w-[184px]"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                setFindOpen(false);
              }
            }}
            placeholder="Search keys and values"
            ref={findInput}
            size="sm"
            spellCheck={false}
            tabIndex={findOpen ? undefined : -1}
            value={query}
          />
        </span>
        <Tip tip={findOpen ? "Close search · Esc" : "Search keys and values"}>
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
      </div>
      <Button
        disabled={readOnly || editing || view.status === "unread"}
        onClick={() => {
          if (scope === undefined) return;
          setOpenRow(null);
          setMode({ kind: "text", text: vaultToText(scope) });
        }}
        size="xs"
        variant="ghost-muted"
      >
        <TextIcon />
        Edit as text
      </Button>
      <Button
        className="ml-1"
        disabled={readOnly || editing || view.status === "unread"}
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
    </div>
  );

  if (view.status === "unread" || scope === undefined) {
    return (
      <div className="vault-panel flex h-full min-h-0 flex-col bg-card" data-vault-panel="unread">
        {header}
        <div className="mx-4 mb-3 h-8 rounded-lg">
          <Skeleton className="h-8 w-full" />
        </div>
        <div aria-busy="true" className="grid gap-0" data-vault-skeleton>
          {[0, 1, 2, 3].map((index) => (
            <div className="mx-2 grid h-[52px] content-center gap-1.5 px-2" key={index}>
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const sections = scopeSections(scope, q);
  const rowProps = (value: VaultScope["values"][number]) => ({
    view,
    scope,
    value,
    open: openRow === value.id,
    flash: flash === value.id,
    activity: activityOf(scope, value.key),
    monograms,
    actor: props.actor,
    mateName,
    nowMs,
    restarting,
    impactOf: (change: VaultWrite) => props.impactOf(scope.ref, change),
    onToggle: () => setOpenRow((current) => (current === value.id ? null : value.id)),
    onWrite: (change: VaultWrite) => {
      void write(scope, change).then((ok) => {
        if (ok) setOpenRow((current) => (current === value.id ? null : current));
      });
    },
    onRestart: (serviceId: string) => restart(serviceId),
  });
  const addKey = mode.kind === "add" ? local.sending : null;
  const addBusy = addKey !== null && [...addKey].some((key) => key.startsWith(`${scope.id}:`));

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
              writes: diffVaultText(scope, mode.text).writes,
            })
          }
          scope={scope}
          text={mode.text}
        />
      );
    }
    if (mode.kind === "review") {
      return (
        <VaultReview
          applying={applying}
          impactOf={(change) => props.impactOf(scope.ref, change)}
          mateName={props.actor === "mate" ? mateName : null}
          onApply={(writes) => {
            setApplying(true);
            void (async () => {
              for (const change of writes) await write(scope, change);
              setApplying(false);
              setMode({ kind: "list" });
            })();
          }}
          onBack={() => setMode({ kind: "text", text: mode.text })}
          scope={scope}
          writes={mode.writes}
        />
      );
    }
    const empty = sections.plain.length === 0 && sections.sensitive.length === 0;
    return (
      <>
        {mode.kind === "add" ? (
          <VaultAddCard
            busy={addBusy}
            key={scope.id}
            onAdd={(change) => {
              void write(scope, change).then((ok) => {
                if (ok) setMode({ kind: "list" });
              });
            }}
            onCancel={() => setMode({ kind: "list" })}
            onPasteEnv={(pasted) =>
              setMode({ kind: "text", text: pasteIntoText(vaultToText(scope), pasted) })
            }
            refusal={
              [...local.refused].find(([key]) => key.startsWith(`${scope.id}:`))?.[1] ?? null
            }
            scope={scope}
          />
        ) : null}
        {scope.kind === "managed" ? (
          <p className="mx-4 mb-1 flex items-start gap-2 text-xs leading-4.5 text-muted-foreground">
            <DatabaseIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Zerops made these with {scopeName(scope)}. They're read-only; a service reads one as{" "}
              <code className="font-mono">{`\${${scopeName(scope)}_${scope.values[0]?.key ?? "password"}}`}</code>
              .
            </span>
          </p>
        ) : null}
        {(["plain", "sensitive"] as const).map((which) =>
          sections[which].length === 0 ? null : (
            <div data-vault-section={which} key={which}>
              <div className="vault-section h-[30px] px-4 pt-1.5 font-medium text-2xs text-muted-foreground">
                {which === "sensitive" ? (
                  <LockIcon aria-hidden="true" className="size-[11px] opacity-80" />
                ) : null}
                <span>{which === "sensitive" ? "Sensitive" : "Plain"}</span>
              </div>
              {sections[which].map((value) =>
                scope.kind === "managed" ? (
                  <VaultManagedRow key={value.id} scope={scope} value={value} />
                ) : (
                  <VaultRow key={value.id} {...rowProps(value)} />
                ),
              )}
            </div>
          ),
        )}
        {empty && q !== "" ? (
          <NoMatch onPick={pickScope} query={q} scope={scope} scopes={view.scopes} />
        ) : empty && mode.kind !== "add" ? (
          <p className="mx-4 my-3.5 flex flex-wrap items-baseline gap-1.5 text-line text-muted-foreground">
            <span>Nothing in {scopeName(scope)} yet.</span>
            {scope.editable ? (
              <InlineButton onClick={() => setMode({ kind: "add" })}>Add one</InlineButton>
            ) : null}
          </p>
        ) : null}
        {scope.kind === "runtime" && q === "" ? (
          <VaultReads onGoto={(id, key) => goto(id, key, null)} scope={scope} view={view} />
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
      <ScopeBar current={scope.id} onPick={pickScope} query={q} scopes={view.scopes} />
      <div
        className={
          scrolled
            ? "min-h-0 flex-1 overflow-y-auto border-t border-border/60 pb-11 [scrollbar-width:thin]"
            : "min-h-0 flex-1 overflow-y-auto border-t border-transparent pb-11 [scrollbar-width:thin]"
        }
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        ref={scroller}
      >
        {view.status === "failed" ? (
          <p className="mx-4 mb-2.5 text-line text-muted-foreground" data-vault-failed role="alert">
            Couldn't read the vault
          </p>
        ) : null}
        <VaultNotLive
          actor={props.actor}
          items={view.notLive}
          mate={props.who.kind === "mate" ? props.who : null}
          monograms={monograms}
          onOpen={openNotLive}
          onRestart={(serviceId) => restart(serviceId)}
          restarting={restarting}
        />
        <div data-vault-list={scope.id}>{list()}</div>
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

function ScopeBar(props: {
  readonly scopes: ReadonlyArray<VaultScope>;
  readonly current: string;
  readonly query: string;
  readonly onPick: (id: string) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  // The pill sits under the scope picked, each as wide as its name: measured, not divided, so a
  // project of many services scrolls sideways instead of cutting their names; the one picked stays
  // in view.
  useLayoutEffect(() => {
    const row = bar.current;
    if (row === null || props.scopes.length === 0) return;
    const place = () => {
      const tab = row.querySelector<HTMLElement>(
        `[data-vault-scope="${CSS.escape(props.current)}"]`,
      );
      if (tab === null || pill.current === null) return;
      pill.current.style.setProperty("--vault-pill-x", `${tab.offsetLeft}px`);
      pill.current.style.setProperty("--vault-pill-w", `${tab.offsetWidth}px`);
      const right = tab.offsetLeft + tab.offsetWidth;
      if (tab.offsetLeft < row.scrollLeft) row.scrollLeft = tab.offsetLeft - 2;
      else if (right > row.scrollLeft + row.clientWidth)
        row.scrollLeft = right - row.clientWidth + 2;
    };
    place();
    // A tab grows with its count; the row with the panel.
    const observer = new ResizeObserver(place);
    observer.observe(row);
    for (const tab of row.querySelectorAll("[data-vault-scope]")) observer.observe(tab);
    return () => observer.disconnect();
  }, [props.current, props.scopes]);
  return (
    <div aria-label="Scope" className="vault-scopes mx-4 mb-3 flex-none" ref={bar} role="tablist">
      <span aria-hidden="true" className="vault-scope-pill" ref={pill} />
      {props.scopes.map((scope) => {
        const count = scopeCount(scope, props.query);
        const selected = scope.id === props.current;
        const tab = (
          <button
            aria-selected={selected}
            className={
              props.query !== "" && count === 0
                ? "vault-scope flex h-7 shrink-0 items-center px-2.5 justify-center gap-1.5 rounded-md font-medium text-line text-muted-foreground opacity-40"
                : selected
                  ? "vault-scope flex h-7 shrink-0 items-center px-2.5 justify-center gap-1.5 rounded-md font-medium text-line text-foreground"
                  : "vault-scope flex h-7 shrink-0 items-center px-2.5 justify-center gap-1.5 rounded-md font-medium text-line text-muted-foreground hover:text-foreground"
            }
            data-vault-scope={scope.id}
            key={scope.id}
            onClick={() => props.onPick(scope.id)}
            role="tab"
            type="button"
          >
            {scope.kind === "managed" ? (
              <DatabaseIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
            ) : null}
            <span className="whitespace-nowrap">{scopeName(scope)}</span>
            {count > 0 ? (
              <span className="font-normal text-xs text-muted-foreground tabular-nums">
                {count}
              </span>
            ) : null}
          </button>
        );
        return scope.kind === "managed" ? (
          <Tip key={scope.id} tip="Made by Zerops">
            {tab}
          </Tip>
        ) : (
          tab
        );
      })}
    </div>
  );
}

function NoMatch(props: {
  readonly scope: VaultScope;
  readonly scopes: ReadonlyArray<VaultScope>;
  readonly query: string;
  readonly onPick: (id: string) => void;
}) {
  const others = props.scopes
    .filter((scope) => scope.id !== props.scope.id)
    .map((scope) => ({ scope, count: scopeCount(scope, props.query) }))
    .filter(({ count }) => count > 0);
  return (
    <p className="mx-4 my-3.5 flex flex-wrap items-baseline gap-1.5 text-line text-muted-foreground">
      <span>
        Nothing in {scopeName(props.scope)} matches “{props.query}”.
      </span>
      {others.map(({ scope, count }, index) => (
        <span className="flex items-baseline gap-1.5" key={scope.id}>
          {index > 0 ? <span>·</span> : null}
          <InlineButton onClick={() => props.onPick(scope.id)}>
            {count} in {scopeName(scope)}
          </InlineButton>
        </span>
      ))}
    </p>
  );
}
