/**
 * The Vault tab: one environment's values beside a Mate's conversation, in one scroll. On top, one
 * line per thing that needs the person (values its apps don't run yet, values not set, secrets
 * anyone can read), each saying what to do. Then what every app gets, each app's own values, and
 * last the services Zerops runs, folded. Each value is one line: its name in words and its key.
 * Edit as text sits behind the "⋯", one part at a time, and goes through a review.
 *
 * `VaultPanelBody` draws a view it is given and reports writes and restarts; the container
 * (`VaultPanelContainer.tsx`) feeds it from the account's `vault` projection and operations; the
 * harness (`/design-vault.html`) draws it over the fixture.
 */
import { Section } from "../../ui/section";
import type {
  VaultImpact,
  VaultRevealed,
  VaultScope,
  VaultScopeRef,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { ChevronDownIcon, EllipsisIcon, PlusIcon, SearchIcon, TextIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Skeleton } from "../../ui/skeleton";
import {
  impactLine,
  notLiveLine,
  notLiveTarget,
  refusalWords,
  scopeName,
  vaultRowKey,
} from "./vault.logic";
import { VaultAddCard, VaultReview, VaultTextEditor } from "./VaultEditors";
import {
  serviceWords,
  vaultGroups,
  vaultNeeds,
  vaultSections,
  type VaultEntry,
} from "./vaultGroups.logic";
import { VaultLines } from "./VaultLines";
import { VaultManagedRows, VaultRow, type VaultRowActivity } from "./VaultRow";
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
  /** Decrypts a secret for the person who asks to see it; no Show without it. */
  readonly onReveal?: (scope: VaultScopeRef, id: string) => Promise<VaultRevealed>;
  /** The clock relative times are read against; now when absent. */
  readonly nowMs?: number;
}

const SETTLE_MS = 1400;
const IMPACT_MS = 8000;
const FLASH_MS = 1500;

type Mode =
  | { readonly kind: "list" }
  | { readonly kind: "add" }
  | { readonly kind: "text"; readonly scopeId: string; readonly text: VaultText }
  | {
      readonly kind: "review";
      readonly scopeId: string;
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
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [openMade, setOpenMade] = useState<ReadonlySet<string>>(() => new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [applying, setApplying] = useState(false);
  const [local, setLocal] = useState<Local>(EMPTY_LOCAL);
  const [restartingLocal, setRestartingLocal] = useState<ReadonlySet<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  const mateName = props.who.kind === "mate" ? props.who.name : null;
  const restarting = new Set([...props.restarting, ...restartingLocal]);
  const q = query.trim();
  const writable = view.scopes.filter((scope) => scope.editable);

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

  /** Opens a value in place and brings it into view. */
  const reveal = (scope: VaultScope, valueId: string, key: string) => {
    setQuery("");
    setMode({ kind: "list" });
    const rowKey = vaultRowKey(scope.id, valueId);
    if (scope.editable) setOpenRow(rowKey);
    setFlash(rowKey);
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(
          `[data-vault-part="${CSS.escape(scope.id)}"] [data-vault-row="${CSS.escape(key)}"]`,
        )
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  const editing = mode.kind === "text" || mode.kind === "review";
  const shared = view.scopes.find((scope) => scope.kind === "shared");

  const header = (
    <div className="flex h-12 flex-none items-center gap-1.5 pr-2.5 pl-3" data-vault-header>
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search"
          autoComplete="off"
          disabled={view.status === "unread" || editing}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          placeholder="Search values"
          size="sm"
          spellCheck={false}
          value={query}
        />
        {query === "" ? null : (
          <InputGroupAddon align="inline-end">
            <Button
              aria-label="Clear search"
              onClick={() => setQuery("")}
              size="icon-sm"
              variant="ghost-muted"
            >
              <XIcon />
            </Button>
          </InputGroupAddon>
        )}
      </InputGroup>
      <Button
        disabled={view.status === "unread" || editing || writable.length === 0}
        onClick={() => {
          setOpenRow(null);
          setQuery("");
          setMode({ kind: "add" });
        }}
        size="sm"
        variant="secondary"
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
              size="icon-sm"
              variant="ghost-muted"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-52">
          {writable.map((scope) => (
            <MenuItem
              disabled={editing}
              key={scope.id}
              onClick={() => {
                setOpenRow(null);
                setQuery("");
                setMode({ kind: "text", scopeId: scope.id, text: vaultToText(scope) });
              }}
            >
              <TextIcon />
              {scopeName(scope)} as text
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );

  // Until the vault has been read whole, an empty list proves nothing: hold the list's place
  // rather than say there are no values.
  const holding =
    view.status === "unread" ||
    shared === undefined ||
    (view.status === "ready" &&
      !view.complete &&
      view.scopes.every((scope) => scope.values.length === 0));
  if (holding) {
    return (
      <div
        className="vault-panel flex h-full min-h-0 flex-col bg-background"
        data-vault-panel="unread"
      >
        {header}
        <div aria-busy="true" className="vault-canvas min-h-0 flex-1 px-3 pt-1" data-vault-skeleton>
          <Skeleton className="mx-1 mt-2 mb-2 h-3.5 w-20" />
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
        onReveal={props.onReveal}
        onToggle={() => setOpenRow((current) => (current === rowKey ? null : rowKey))}
        onWrite={(change) => {
          void write(entry.scope, change).then((ok) => {
            if (ok) setOpenRow((current) => (current === rowKey ? null : current));
          });
        }}
        open={openRow === rowKey}
        restarting={restarting}
        scope={entry.scope}
        value={entry.value}
        view={view}
      />
    );
  };

  const list = (): ReactNode => {
    const editScope =
      mode.kind === "text" || mode.kind === "review"
        ? view.scopes.find((scope) => scope.id === mode.scopeId)
        : undefined;
    if (mode.kind === "text" && editScope !== undefined) {
      return (
        <VaultTextEditor
          onCancel={() => setMode({ kind: "list" })}
          onChange={(text) => setMode({ ...mode, text })}
          onReview={() =>
            setMode({
              kind: "review",
              scopeId: mode.scopeId,
              text: mode.text,
              writes: diffVaultText(editScope, mode.text).writes,
            })
          }
          scope={editScope}
          text={mode.text}
        />
      );
    }
    if (mode.kind === "review" && editScope !== undefined) {
      return (
        <VaultReview
          applying={applying}
          impactOf={(change) => props.impactOf(editScope.ref, change)}
          mateName={props.actor === "mate" ? mateName : null}
          onApply={(writes) => {
            setApplying(true);
            void (async () => {
              for (const change of writes) await write(editScope, change);
              setApplying(false);
              setMode({ kind: "list" });
            })();
          }}
          onBack={() => setMode({ kind: "text", scopeId: mode.scopeId, text: mode.text })}
          scope={editScope}
          writes={mode.writes}
        />
      );
    }

    const { sections, made } = vaultSections(view, q);
    const needs = vaultNeeds(vaultGroups(view, { kind: "everything" }, ""));
    const notLive = notLiveLine(view.notLive, props.actor === "mate" ? mateName : null);
    const firstNotLive = view.notLive.find((item) => item.kind === "restart");
    return (
      <>
        {mode.kind === "add" ? (
          <VaultAddCard
            busy={[...local.sending].length > 0}
            onAdd={(scope, change) => {
              void write(scope, change).then((ok) => {
                if (ok) setMode({ kind: "list" });
              });
            }}
            onCancel={() => setMode({ kind: "list" })}
            onPasteEnv={(scope, pasted) =>
              setMode({
                kind: "text",
                scopeId: scope.id,
                text: pasteIntoText(vaultToText(scope), pasted),
              })
            }
            refusal={[...local.refused.values()][0] ?? null}
            scopes={writable}
          />
        ) : null}
        {q === "" && mode.kind === "list" ? (
          <VaultLines
            actor={props.actor}
            busy={(entry) => activityOf(entry.scope, entry.value.key).kind === "busy"}
            needs={needs}
            notLive={notLive}
            onOpenNotLive={() => {
              if (firstNotLive === undefined) return;
              const found = notLiveTarget(view, firstNotLive);
              if (found === null || found.valueId === null) return;
              const scope = view.scopes.find((candidate) => candidate.id === found.scopeId);
              const value = scope?.values.find((candidate) => candidate.id === found.valueId);
              if (scope !== undefined && value !== undefined) reveal(scope, value.id, value.key);
            }}
            onOpenUnset={(entry) => reveal(entry.scope, entry.value.id, entry.value.key)}
            onRestart={(serviceId) => restart(serviceId)}
            onWrite={(entry, change) => write(entry.scope, change)}
            restarting={restarting}
          />
        ) : null}
        {sections.map((section) => (
          <Section
            action={
              section.scope.hostname === null
                ? undefined
                : props.renderDeployConfig?.(section.scope.hostname)
            }
            count={section.words ?? undefined}
            data-vault-part={section.scope.id}
            key={section.scope.id}
            level={3}
            title={section.title}
          >
            <div className="vault-box">
              <div className="vault-rows">{section.entries.map(rowOf)}</div>
            </div>
          </Section>
        ))}
        {made.length > 0 ? (
          <div className="vault-box" data-vault-made>
            <div className="vault-rows">
              {made.map((scope) => {
                const open = openMade.has(scope.id);
                const { words } = serviceWords(scope);
                return (
                  <div
                    className="vault-row"
                    data-open={open ? "" : undefined}
                    data-vault-app={scope.hostname}
                    key={scope.id}
                  >
                    <button
                      aria-expanded={open}
                      className="flex h-11 w-full items-center gap-2 px-3.5 text-left text-line outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      onClick={() =>
                        setOpenMade((current) => {
                          const next = new Set(current);
                          if (!next.delete(scope.id)) next.add(scope.id);
                          return next;
                        })
                      }
                      type="button"
                    >
                      <span className="text-foreground">{scope.hostname}</span>
                      {words === null ? null : (
                        <span className="truncate text-muted-foreground">{words}</span>
                      )}
                      <span className="grow" />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {scope.values.length} made by Zerops
                      </span>
                      <ChevronDownIcon
                        aria-hidden="true"
                        className="vault-chevron size-4 shrink-0 text-muted-foreground"
                      />
                    </button>
                    <div className="vault-row-body" inert={!open}>
                      <div>
                        {open ? (
                          <div className="vault-rows vault-made-rows">
                            <VaultManagedRows onReveal={props.onReveal} scope={scope} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {sections.length === 0 && made.length === 0 && q !== "" ? (
          <p className="px-1 py-2 text-line text-muted-foreground">Nothing matches “{q}”.</p>
        ) : sections.length === 0 && made.length === 0 && q === "" && mode.kind === "list" ? (
          <p className="px-1 py-2 text-line text-muted-foreground">No values yet.</p>
        ) : null}
      </>
    );
  };

  return (
    <div
      className="vault-panel flex h-full min-h-0 flex-col bg-background"
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
        <div className="grid gap-6 px-3 pt-1 pb-12" data-vault-list>
          {view.status === "failed" ? (
            <p className="px-1 text-line text-muted-foreground" data-vault-failed role="alert">
              Couldn't read the vault
            </p>
          ) : null}
          {list()}
        </div>
      </div>
    </div>
  );
}
