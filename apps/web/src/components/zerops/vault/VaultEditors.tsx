/**
 * The vault's two editors: the add card at the top of a scope's list (a key, a value, the
 * sensitive switch that turns itself on for a secret-sounding name, inline validation; a pasted
 * `.env` jumps to the text), and the scope as `.env` text with its review — one line per change
 * and what it means, a removal that services read held until the person says remove anyway.
 */
import type { VaultImpact, VaultScope, VaultWrite } from "@t3tools/client-runtime/data";
import { CircleAlertIcon, DicesIcon, LockIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import { Switch } from "../../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  generateVaultValue,
  keyProblem,
  reviewLine,
  scopeName,
  sensitiveWordIn,
} from "./vault.logic";
import {
  diffVaultText,
  envPasteLines,
  VAULT_MASK,
  type VaultText,
  type VaultTextSection,
} from "./vaultText.logic";

export interface VaultAddCardProps {
  readonly scope: VaultScope;
  /** Why the platform refused the last add, if it did. */
  readonly refusal: string | null;
  readonly busy: boolean;
  readonly onAdd: (write: Extract<VaultWrite, { kind: "add" }>) => void;
  readonly onCancel: () => void;
  /** A multi-line `.env` pasted into the key: the panel opens the text with it. */
  readonly onPasteEnv: (pasted: string) => void;
}

export function VaultAddCard(props: VaultAddCardProps) {
  const { scope } = props;
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  /** The person's own say on the switch; until then the name decides. */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const word = sensitiveWordIn(key);
  const sensitive = chosen ?? word !== null;
  const problem = keyProblem(key, scope);
  const error = problem ?? props.refusal;
  const canSave = key !== "" && problem === null && !props.busy;

  const save = () => {
    if (!canSave) return;
    props.onAdd({ kind: "add", key, value, sensitive });
  };
  const onKeys = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") props.onCancel();
  };

  return (
    <div className="mx-2 mt-0.5 mb-2 vault-card rounded-xl bg-card p-px" data-vault-add>
      <div className="flex items-center gap-1.5 px-3 pt-2.5 font-medium text-xs text-foreground">
        <PlusIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        New value in {scopeName(scope)}
      </div>
      <div className="grid gap-2 px-3 pt-2.5 pb-3">
        <div className="grid grid-cols-[156px_minmax(0,1fr)_auto] items-center gap-2">
          <Input
            aria-invalid={problem !== null}
            aria-label="Key"
            autoComplete="off"
            autoFocus
            font="mono"
            onChange={(event) => setKey(event.currentTarget.value)}
            onKeyDown={onKeys}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              if (envPasteLines(pasted) === null) return;
              event.preventDefault();
              props.onPasteEnv(pasted);
            }}
            placeholder="KEY"
            size="sm"
            spellCheck={false}
            value={key}
          />
          <Input
            aria-label="Value"
            autoComplete="off"
            font="mono"
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={onKeys}
            placeholder="Value"
            size="sm"
            spellCheck={false}
            type={sensitive ? "password" : "text"}
            value={value}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Generate a value"
                  onClick={() => setValue(generateVaultValue())}
                  size="icon-xs"
                  variant="ghost-muted"
                />
              }
            >
              <DicesIcon />
            </TooltipTrigger>
            <TooltipPopup>Generate a value · 32 random bytes</TooltipPopup>
          </Tooltip>
        </div>
        {error === null ? null : (
          <p
            className="flex items-center gap-1.5 text-xs leading-4 text-destructive-foreground"
            data-vault-add-error
            role="alert"
          >
            <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <label className="flex h-7 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch
              aria-label="Sensitive"
              checked={sensitive}
              onCheckedChange={(next) => setChosen(next)}
            />
            <LockIcon aria-hidden="true" className="size-3" />
            <span className={sensitive ? "text-foreground" : undefined}>Sensitive</span>
          </label>
          <span className="truncate text-xs text-muted-foreground" data-vault-add-auto>
            {sensitive && chosen === null && word !== null
              ? `on because the name holds ${word}`
              : sensitive
                ? "write-only once saved"
                : ""}
          </span>
          <span className="grow" />
          <Button onClick={props.onCancel} size="xs" variant="ghost-muted">
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={save} size="xs">
            {props.busy ? <Spinner size="xs" /> : null}
            Save
          </Button>
        </div>
        <p className="text-xs leading-4 text-muted-foreground">
          Enter saves · Esc cancels · paste a whole .env into KEY to add many
        </p>
      </div>
    </div>
  );
}

const MARK_CLASS = {
  "+": "text-status-ok-text",
  "~": "text-warning-foreground",
  "!": "text-destructive-foreground",
} as const;

/** Each line with where it starts in its section: a key that stays while lines above it hold. */
function lineStarts(lines: ReadonlyArray<string>) {
  let start = 0;
  return lines.map((text, line) => {
    const entry = { start, line };
    start += text.length + 1;
    return entry;
  });
}

export interface VaultTextEditorProps {
  readonly scope: VaultScope;
  readonly text: VaultText;
  readonly onChange: (text: VaultText) => void;
  readonly onCancel: () => void;
  readonly onReview: () => void;
}

/** The scope as `.env` text: plain and sensitive, each line marked by what it would do. */
export function VaultTextEditor(props: VaultTextEditorProps) {
  const diff = diffVaultText(props.scope, props.text);
  const changes = diff.writes.length;
  const section = (which: VaultTextSection, label: string) => {
    const lines = props.text[which] === "" ? [""] : props.text[which].split("\n");
    return (
      <div className="grid gap-1.5">
        <div className="flex items-center gap-1.5 font-medium text-2xs text-muted-foreground">
          {which === "sensitive" ? <LockIcon aria-hidden="true" className="size-3" /> : null}
          {label}
        </div>
        <div className="grid grid-cols-[26px_minmax(0,1fr)] overflow-hidden rounded-md bg-muted focus-within:ring-1 focus-within:ring-ring">
          <div
            aria-hidden="true"
            className="vault-gutter py-2 text-center font-mono font-medium text-xs leading-5"
          >
            {lineStarts(lines).map(({ start, line }) => {
              const mark = diff.marks[which][line] ?? null;
              return (
                <span className={mark === null ? undefined : MARK_CLASS[mark]} key={start}>
                  {mark}
                </span>
              );
            })}
          </div>
          <textarea
            aria-label={`${label} values as text`}
            className="vault-textarea block w-full resize-none overflow-x-auto bg-transparent py-2 pr-2.5 pl-1 font-mono text-xs leading-5 whitespace-pre text-foreground outline-none"
            onChange={(event) =>
              props.onChange({ ...props.text, [which]: event.currentTarget.value })
            }
            spellCheck={false}
            value={props.text[which]}
          />
        </div>
      </div>
    );
  };
  return (
    <section className="grid gap-3 px-4 pt-1 pb-2" data-vault-text>
      <div className="flex items-center gap-2">
        <span className="font-medium text-line">{scopeName(props.scope)}</span>
        <span className="text-xs text-muted-foreground">as text</span>
        <span className="grow" />
        <Button onClick={props.onCancel} size="xs" variant="ghost-muted">
          Cancel
        </Button>
        <Button
          disabled={changes === 0 || diff.problems.length > 0}
          onClick={props.onReview}
          size="xs"
        >
          {changes === 0 ? "Review" : `Review ${changes} change${changes > 1 ? "s" : ""}`}
        </Button>
      </div>
      {section("plain", "Plain")}
      {section("sensitive", "Sensitive")}
      {diff.problems.length === 0 ? null : (
        <ul className="grid gap-1" data-vault-text-problems>
          {diff.problems.map((problem) => (
            <li
              className="flex items-center gap-1.5 text-xs text-destructive-foreground"
              key={`${problem.section}:${problem.line}`}
            >
              <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {problem.message}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-4 text-muted-foreground">
        {VAULT_MASK} keeps the stored value. Type over it to replace it; delete the line to remove
        it.
      </p>
    </section>
  );
}

export interface VaultReviewProps {
  readonly scope: VaultScope;
  readonly writes: ReadonlyArray<VaultWrite>;
  readonly impactOf: (write: VaultWrite) => VaultImpact;
  readonly mateName: string | null;
  readonly applying: boolean;
  readonly onApply: (writes: ReadonlyArray<VaultWrite>) => void;
  readonly onBack: () => void;
}

const REVIEW_MARK_CLASS = {
  "+": "text-status-ok-text",
  "~": "text-warning-foreground",
  "−": "text-destructive-foreground",
} as const;

/** One line per change with what it means; a removal that services read waits for a yes. */
export function VaultReview(props: VaultReviewProps) {
  const [forced, setForced] = useState<ReadonlySet<string>>(() => new Set());
  const lines = props.writes.map((write) => ({
    write,
    line: reviewLine(write, props.impactOf(write)),
  }));
  const applied = lines.filter(({ write, line }) => !line.guarded || forced.has(write.key));
  return (
    <section className="grid px-4 pt-1 pb-2" data-vault-review>
      <div className="flex items-center gap-2 pb-2">
        <span className="font-medium text-line">Review changes</span>
        <span className="text-xs text-muted-foreground">{scopeName(props.scope)}</span>
      </div>
      {lines.map(({ write, line }) => (
        <div
          className={
            line.guarded && !forced.has(write.key)
              ? "-mx-2 grid grid-cols-[20px_minmax(0,1fr)] gap-x-1.5 rounded-md bg-warning-surface px-2 pt-2.25 pb-2.5"
              : "grid grid-cols-[20px_minmax(0,1fr)] gap-x-1.5 border-t border-border/60 pt-2.25 pb-2.5"
          }
          data-vault-review-line={write.key}
          key={`${write.kind}:${write.key}`}
        >
          <span
            className={`text-center font-mono font-medium text-line leading-5 ${REVIEW_MARK_CLASS[line.mark]}`}
          >
            {line.mark}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-mono font-medium text-xs leading-5 text-foreground">
                {line.key}
              </span>
              <span className="min-w-0 truncate font-mono text-xs leading-5 text-muted-foreground">
                {write.kind === "remove"
                  ? ""
                  : write.sensitive
                    ? write.kind === "add"
                      ? "sensitive"
                      : "new value"
                    : write.value}
              </span>
            </div>
            <div className="text-xs leading-4.5 text-muted-foreground">
              {forced.has(write.key) ? `${line.consequence} · removing anyway` : line.consequence}
            </div>
            {line.guarded && !forced.has(write.key) ? (
              <div className="mt-2 flex gap-1.5">
                <Button
                  onClick={() => setForced((current) => new Set(current).add(write.key))}
                  size="xs"
                  variant="ghost-destructive"
                >
                  Remove anyway
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 border-t border-border/60 pt-3 pb-1">
        <Button
          disabled={applied.length === 0 || props.applying}
          onClick={() => props.onApply(applied.map(({ write }) => write))}
          size="xs"
        >
          {props.applying ? <Spinner size="xs" /> : null}
          {props.applying
            ? "Applying"
            : `Apply ${applied.length} change${applied.length === 1 ? "" : "s"}`}
        </Button>
        <Button onClick={props.onBack} size="xs" variant="ghost-muted">
          Back to text
        </Button>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {props.mateName === null
            ? "Each one shows what it needs once applied"
            : `${props.mateName} hears about them with your next message`}
        </span>
      </div>
    </section>
  );
}
