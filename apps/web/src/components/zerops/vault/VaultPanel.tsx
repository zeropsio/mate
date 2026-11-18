/**
 * The Vault tab: one environment's values beside a Mate's conversation, in one scroll. On top, one
 * line per thing that needs the person (values its apps don't run yet, values not set, secrets
 * anyone can read), each saying what to do. Then what every app gets, each app's own values, the
 * services Zerops runs, folded, and last the Mate's own (which only the Mate reads). Each value is
 * one line: its name in words and its key.
 * Edit as text sits behind the "⋯", one part at a time, and goes through a review.
 *
 * `VaultPanelBody` draws a view it is given and reports writes and restarts; the container
 * (`VaultPanelContainer.tsx`) feeds it from the account's `vault` projection and operations; the
 * harness (`/design-vault.html`) draws it over the fixture.
 */
import { Section } from "../../ui/section";
import type {
  VaultImpact,
  VaultRestarts,
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
import { Spinner } from "../../ui/spinner";
import {
  impactLine,
  joinNames,
  notLiveLine,
  notLiveTarget,
  OWN_VAULTS_LABEL,
  refusalWords,
  vaultName,
  vaultRowKey,
} from "./vault.logic";
import { VaultAddCard, VaultReview, VaultTextEditor } from "./VaultEditors";
import {
  notRestartedWords,
  restartedWords,
  restartingWords,
  type RestartsEnded,
} from "./readerRestarts";
import {
  serviceWords,
  vaultGroups,
  vaultNeeds,
  vaultSections,
  type VaultEntry,
  type VaultSection,
} from "./vaultGroups.logic";
import { VaultLines } from "./VaultLines";
import { VaultPartName } from "./VaultPartName";
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
  /**
   * What a save restarts, read before it: the running services that read what it writes, once
   * each however many values change, and the readers that run nothing now. None restart without it.
   */
  readonly restartsOf?: (scope: VaultScopeRef, writes: ReadonlyArray<VaultWrite>) => VaultRestarts;
  /** Restarts them after the save, in turn; says which restarted and which did not, and why. */
  readonly onRestartReaders?: (plan: VaultRestarts) => Promise<RestartsEnded>;
  readonly onRestart: (serviceId: string) => Promise<void>;
  /** A link to an app's deploy config, drawn by whoever knows the workspace; none without one. */
  readonly renderDeployConfig?: (hostname: string) => ReactNode;
  /** Decrypts a secret for the person who asks to see it; no Show without it. */
  readonly onReveal?: (scope: VaultScopeRef, id: string) => Promise<VaultRevealed>;
  /** The clock relative times are read against; now when absent. */
  readonly nowMs?: number;
  /** Reads the vault again after a read that failed: *Try again*; none without it. */
  readonly onRetry?: () => void;
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
  /**
   * Rows that just saved: their check, then their impact line until it times out — held while
   * the services that read them restart.
   */
  readonly settled: ReadonlyMap<
    string,
    { readonly at: number; readonly line: string | null; readonly held?: boolean }
  >;
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
  // A removal's restarts, said on the panel since its row is gone: held while they run.
  const [notice, setNotice] = useState<{ readonly line: string; readonly held: boolean } | null>(
    null,
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  const mateName = props.who.kind === "mate" ? props.who.name : null;
  const restarting = new Set([...props.restarting, ...restartingLocal]);
  const q = query.trim();
  const writable = view.scopes.filter((scope) => scope.editable);

  // A settled row's check and impact line go on their own, each at its instant: one timer, armed
  // at the earliest still ahead, then at the next.
  useEffect(() => {
    const instants = [...local.settled.values()].flatMap((entry) =>
      entry.held === true ? [entry.at + SETTLE_MS] : [entry.at + SETTLE_MS, entry.at + IMPACT_MS],
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const now = Date.now();
      const next = Math.min(...instants.filter((instant) => instant > now));
      if (!Number.isFinite(next)) return;
      timer = setTimeout(() => {
        const at = Date.now();
        setClock(at);
        setLocal((current) => {
          const settled = new Map(
            [...current.settled].filter(
              ([, entry]) => entry.held === true || at - entry.at < IMPACT_MS,
            ),
          );
          return settled.size === current.settled.size ? current : { ...current, settled };
        });
        arm();
      }, next - now);
    };
    arm();
    return () => clearTimeout(timer);
  }, [local.settled]);

  useEffect(() => {
    if (notice === null || notice.held) return;
    const timer = setTimeout(() => setNotice(null), IMPACT_MS);
    return () => clearTimeout(timer);
  }, [notice]);

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
      return {
        kind: "refused",
        reason: refusalWords(pending.code, scope, key, pending.message, mateName),
      };
    }
    const settled = local.settled.get(rowKey);
    if (settled !== undefined) {
      return { kind: "settled", line: settled.line, check: nowMs - settled.at < SETTLE_MS };
    }
    return { kind: "idle" };
  };

  /** Says one line on each saved row: restarting while held, then how the restarts ended. */
  const settleRows = (rowKeys: ReadonlyArray<string>, line: string | null, held: boolean) => {
    if (rowKeys.length === 0) return;
    setLocal((current) => {
      const at = Date.now();
      setClock(at);
      const settled = new Map(current.settled);
      for (const rowKey of rowKeys) {
        const before = settled.get(rowKey);
        // A restart that ends keeps the row's check moment; its line times out from now.
        settled.set(rowKey, { at: held ? (before?.at ?? at) : at, line, held });
      }
      return { ...current, settled };
    });
  };

  /**
   * Restarts what a save's values reach, then says on the saved rows how it ended — a removal,
   * whose row is gone, on the panel.
   */
  const restartAfter = async (
    plan: VaultRestarts,
    rowKeys: ReadonlyArray<string>,
    removed: string | null = null,
  ) => {
    if (props.onRestartReaders === undefined || plan.restart.length === 0) return;
    if (removed === null) settleRows(rowKeys, restartingWords(plan.restart), true);
    else setNotice({ line: `Removed ${removed} · ${restartingWords(plan.restart)}`, held: true });
    const { restarted, failed } = await props.onRestartReaders(plan);
    const said =
      failed === null
        ? restartedWords(restarted, plan.notRunning, plan.deploying)
        : [restartedWords(restarted, []), notRestartedWords(failed)]
            .filter((part): part is string => part !== null)
            .join(" · ");
    if (removed !== null)
      setNotice({ line: `Removed ${removed} · ${said ?? "done"}`, held: false });
    else settleRows(rowKeys, said === null ? null : `Saved · ${said}`, false);
  };

  /** The line a saved row says before any restart: what runs nothing, else what reads it. */
  const savedLine = (impact: VaultImpact, plan: VaultRestarts | undefined) =>
    plan === undefined
      ? impactLine(impact)
      : plan.restart.length > 0
        ? restartingWords(plan.restart)
        : (restartedWords([], plan.notRunning, plan.deploying) ??
          (impact.unread ? impactLine(impact) : null));

  const write = async (
    scope: VaultScope,
    change: VaultWrite,
    /** Restart its readers once it is saved; a batch restarts once, after all its writes. */
    restart = true,
  ): Promise<boolean> => {
    const rowKey = vaultRowKey(scope.id, change.key);
    const impact = props.impactOf(scope.ref, change);
    const plan = props.restartsOf?.(scope.ref, [change]);
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
          const held = restart && plan !== undefined && plan.restart.length > 0;
          settled.set(rowKey, { at, line: savedLine(impact, plan), held });
          setClock(at);
        }
      } else {
        refused.set(
          rowKey,
          refusalWords(outcome.code, scope, change.key, outcome.message, mateName),
        );
      }
      return { sending, refused, settled };
    });
    if (outcome.ok && restart && plan !== undefined)
      void restartAfter(
        plan,
        change.kind === "remove" ? [] : [rowKey],
        change.kind === "remove" ? change.key : null,
      );
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

  // Until the vault has been read whole, an empty list proves nothing: hold the list's place
  // rather than say there are no values. A read that failed with nothing to show says so instead.
  const nothingShown =
    shared === undefined ||
    (!view.complete && view.scopes.every((scope) => scope.values.length === 0));
  // Nothing to search or write in until there are values to show.
  const held = view.status === "unread" || nothingShown;
  const header = (
    <div className="flex h-12 flex-none items-center gap-1.5 pr-2.5 pl-3" data-vault-header>
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search"
          autoComplete="off"
          disabled={held || editing}
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
              variant="ghost"
            >
              <XIcon />
            </Button>
          </InputGroupAddon>
        )}
      </InputGroup>
      <Button
        disabled={held || editing || writable.length === 0}
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
          render={<Button aria-label="More" disabled={held} size="icon-sm" variant="ghost" />}
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
              {vaultName(scope, mateName)} as text
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );

  const failure =
    view.status === "failed" ? (
      <div className="flex min-h-7 items-center gap-3 px-1" data-vault-failed role="alert">
        <p className="text-line text-muted-foreground">Couldn't read the vault</p>
        {props.onRetry === undefined ? null : (
          <Button onClick={props.onRetry} size="sm" variant="secondary">
            Try again
          </Button>
        )}
      </div>
    ) : null;
  if (held) {
    const failed = view.status === "failed";
    return (
      <div
        className="vault-panel flex h-full min-h-0 flex-col bg-background"
        data-vault-panel={failed ? "failed" : "unread"}
      >
        {header}
        <div className="vault-canvas min-h-0 flex-1 border-t border-transparent">
          {failed ? (
            <div className="grid gap-6 px-3 pt-1 pb-12" data-vault-list>
              {failure}
            </div>
          ) : (
            <VaultHeld />
          )}
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
          mateName={mateName}
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
          mateName={mateName}
          onApply={(writes) => {
            setApplying(true);
            // One restart per service for the whole edit, read before any of it is written.
            const plan = props.restartsOf?.(editScope.ref, writes);
            void (async () => {
              const saved: string[] = [];
              for (const change of writes)
                if ((await write(editScope, change, false)) && change.kind !== "remove")
                  saved.push(vaultRowKey(editScope.id, change.key));
              setApplying(false);
              setMode({ kind: "list" });
              const removed = writes.flatMap((change) =>
                change.kind === "remove" ? [change.key] : [],
              );
              if (plan !== undefined)
                await restartAfter(
                  plan,
                  saved,
                  saved.length === 0 && removed.length > 0 ? joinNames(removed) : null,
                );
            })();
          }}
          onBack={() => setMode({ kind: "text", scopeId: mode.scopeId, text: mode.text })}
          scope={editScope}
          writes={mode.writes}
        />
      );
    }

    const { sections, made } = vaultSections(view, q, mateName);
    const forAll = sections.filter((section) => section.scope.kind === "shared");
    const own = sections.filter((section) => section.scope.kind === "runtime");
    const mates = sections.filter((section) => section.scope.kind === "mate");
    const sectionOf = (section: VaultSection) => (
      <Section
        action={
          // An app's deploy config names what it reads; the Mate's own vault has none.
          section.scope.kind !== "runtime" || section.scope.hostname === null
            ? undefined
            : props.renderDeployConfig?.(section.scope.hostname)
        }
        count={section.words}
        data-vault-part={section.scope.id}
        key={section.scope.id}
        level={3}
        title={<VaultPartName mateName={mateName} scope={section.scope} />}
      >
        <div className="vault-box">
          <div className="vault-rows">{section.entries.map(rowOf)}</div>
        </div>
      </Section>
    );
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
            mateName={mateName}
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
        {notice === null ? null : (
          <p
            className="flex items-center gap-1.5 px-1 text-caption text-muted-foreground"
            data-vault-notice
            role="status"
          >
            {notice.held ? <Spinner size="xs" /> : null}
            {notice.line}
          </p>
        )}
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
        {forAll.map(sectionOf)}
        {forAll.length === 0 || own.length === 0 ? (
          own.map(sectionOf)
        ) : (
          // Each app's own stand apart from what every app gets: over twice the room two of them
          // keep, a hairline between, and the group's label hugging its first heading.
          <div className="mt-2 grid gap-1 border-t border-border/70 pt-5" data-vault-own>
            <p className="m-0 text-caption font-medium text-muted-foreground">{OWN_VAULTS_LABEL}</p>
            <div className="grid gap-6">{own.map(sectionOf)}</div>
          </div>
        )}
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
                      className="flex h-11 w-full cursor-pointer items-center gap-2 px-3.5 text-left text-line outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      onClick={() =>
                        setOpenMade((current) => {
                          const next = new Set(current);
                          if (!next.delete(scope.id)) next.add(scope.id);
                          return next;
                        })
                      }
                      type="button"
                    >
                      <span className="font-mono text-caption text-foreground">
                        {scope.hostname}
                      </span>
                      {words === null ? null : (
                        <span className="truncate text-muted-foreground">{words}</span>
                      )}
                      <span className="grow" />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {scope.values.length === 1
                          ? "1 value set by Zerops"
                          : `${scope.values.length} values set by Zerops`}
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
        {mates.length === 0 || forAll.length + own.length + made.length === 0 ? (
          mates.map(sectionOf)
        ) : (
          // The Mate's own comes last, apart from everything the apps read (their vaults and the
          // services Zerops runs for them): the room and hairline the apps' own group has, and
          // its own name for a heading.
          <div className="mt-2 border-t border-border/70 pt-5" data-vault-mate>
            {mates.map(sectionOf)}
          </div>
        )}
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
          {failure}
          {list()}
        </div>
      </div>
    </div>
  );
}

/**
 * The list's place while the vault reads: two sections of three rows in the real rows' shape and
 * height (name and key at the left, the value at the right), so the values take their place
 * without a move.
 */
function VaultHeld() {
  return (
    <div aria-busy="true" className="grid gap-6 px-3 pt-1 pb-12" data-vault-skeleton>
      <HeldSection label={<Skeleton className="h-3.5 w-20" />}>
        <HeldRow name={<Skeleton className="h-3 w-24" surface="card" />} />
        <HeldRow name={<Skeleton className="h-3 w-16" surface="card" />} />
        <HeldRow name={<Skeleton className="h-3 w-28" surface="card" />} />
      </HeldSection>
      <HeldSection label={<Skeleton className="h-3.5 w-14" />}>
        <HeldRow name={<Skeleton className="h-3 w-20" surface="card" />} />
        <HeldRow name={<Skeleton className="h-3 w-28" surface="card" />} />
        <HeldRow name={<Skeleton className="h-3 w-16" surface="card" />} />
      </HeldSection>
    </div>
  );
}

function HeldSection({
  label,
  children,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center">{label}</div>
      <div className="vault-box">
        <div className="vault-rows">{children}</div>
      </div>
    </div>
  );
}

function HeldRow({ name }: { readonly name: ReactNode }) {
  return (
    <div className="flex h-11 items-center gap-3 px-3.5">
      {name}
      <Skeleton className="h-2.5 w-24" surface="card" />
      <Skeleton className="ml-auto h-3 w-16" surface="card" />
    </div>
  );
}
