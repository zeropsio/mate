/**
 * *Add automated Mates*, in words and choices: how many, who they are, what they do and what
 * happens next. Automated Mates belong to the organization — whoever sees the project sees them —
 * so the dialog asks nobody's access, and their names and faces are picked for the person.
 *
 * Pure: no React, no store, no clock.
 */
import type { SettingValue } from "@t3tools/client-runtime/data";
import type { EnvironmentRecipeChoice, ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import { MATE_SHAPE_OF_TINT, MATE_TINT_IDS, type MateTintId } from "@t3tools/shared/brand";
import type { HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import type { HqNavigationIntake } from "@t3tools/shared/hqStream";
import {
  automatedModelOf,
  automatedModelOffer,
  OPENCODE_KEY_PROVIDERS,
} from "@t3tools/shared/openCodeKeyProviders";

import { AUTOMATED_KEY_PROVIDER, type AutomatedKeyState } from "~/zerops/automatedMate.logic";

import { newMateSubmit, type NewMateRecipe } from "./ZeropsEnvironmentCreationDialog.logic";
import { newMateCost } from "./whatHappensNext.logic";

/** How many automated Mates one Add makes: the segmented choice. */
export const AUTOMATED_COUNTS = [1, 2, 3] as const;
export type AutomatedCount = (typeof AUTOMATED_COUNTS)[number];

export function addAutomatedTitle(groupName: string): string {
  return `Add automated Mates to ${groupName}`;
}

export function addAutomatedButton(count: number): string {
  return count === 1 ? "Add 1 automated Mate" : `Add ${String(count)} automated Mates`;
}

/**
 * The names for `count` Mates: the ones already there kept, in order — a count raised proposes
 * new ones (`propose`, given every name taken so far), a count lowered drops the last.
 */
export function automatedNames(
  current: ReadonlyArray<string>,
  count: number,
  propose: (taken: ReadonlyArray<string>) => string,
): ReadonlyArray<string> {
  const names = current.slice(0, count);
  while (names.length < count) names.push(propose(names));
  return names;
}

/**
 * Each Mate's face: the tint the account gives its name (`tintFor`), moved on to the next free one
 * where an earlier Mate of the same Add wears it — three new Mates never look alike — and that
 * tint's shape.
 */
export function automatedFaces(
  names: ReadonlyArray<string>,
  tintFor: (name: string) => MateTintId,
): ReadonlyArray<ZeropsMateFace> {
  const worn = new Set<MateTintId>();
  return names.map((name) => {
    let index = MATE_TINT_IDS.indexOf(tintFor(name.trim()));
    if (worn.size < MATE_TINT_IDS.length)
      while (worn.has(MATE_TINT_IDS[index]!)) index = (index + 1) % MATE_TINT_IDS.length;
    const tint = MATE_TINT_IDS[index]!;
    worn.add(tint);
    return { tint, shape: MATE_SHAPE_OF_TINT[tint] };
  });
}

const SAME_NAME = "Two of them have the same name.";

/**
 * What pressing Add does now: refuse a name — which one, and why — wait on a read, or create
 * every Mate with the project's recipe. Each name is judged as New Mate judges one, the others of
 * this Add counted as taken.
 */
export type AutomatedSubmit =
  | { readonly kind: "refuse"; readonly index: number; readonly error: string }
  | { readonly kind: "wait"; readonly on: "names" | "recipe" }
  | { readonly kind: "create"; readonly recipe: EnvironmentRecipeChoice };

export function automatedSubmit(input: {
  readonly names: ReadonlyArray<string>;
  readonly appName: string;
  readonly takenBotNames: TakenBotNames;
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  readonly tierLoading: boolean;
}): AutomatedSubmit {
  const tidy = input.names.map((name) => name.replace(/\s+/g, " ").trim().toLowerCase());
  let waiting: AutomatedSubmit | undefined;
  let created: AutomatedSubmit | undefined;
  for (const [index, name] of input.names.entries()) {
    if (tidy[index] !== "" && tidy.indexOf(tidy[index]!) !== index)
      return { kind: "refuse", index, error: SAME_NAME };
    const verdict = newMateSubmit({
      botName: name,
      appName: input.appName,
      takenBotNames: input.takenBotNames,
      tier: input.tier,
      tierLoading: input.tierLoading,
    });
    if (verdict.kind === "refuse") return { kind: "refuse", index, error: verdict.error };
    if (verdict.kind === "wait") waiting ??= verdict;
    else created ??= verdict;
  }
  return waiting ?? created ?? { kind: "wait", on: "names" };
}

type ChannelRead = SettingValue<{ readonly channel: { readonly channel: string } | null }>;
type ListRead = SettingValue<ReadonlyArray<unknown>>;

/** Where a project's tasks come from, as read for the dialog. */
export interface AutomatedSourceReads {
  /** Its GitHub intake: `undefined` while not read, `null` where none. */
  readonly intake: HqNavigationIntake | null | undefined;
  readonly slack: ChannelRead;
  readonly discord: ChannelRead;
  readonly webhooks: ListRead;
  readonly schedules: ListRead;
}

/**
 * Where its tasks come from, as the dialog can tell: `reading` until every source is read, then
 * the sources `named`, `none`, or `withheld` where some are refused to the reader or failed to
 * read — never none while one of them is not known.
 */
export type AutomatedSources =
  | { readonly kind: "reading" }
  | { readonly kind: "none" }
  | { readonly kind: "withheld" }
  | { readonly kind: "named"; readonly words: string };

/** The sources in words, joined, once every one of them is read. */
export function automatedSourcesWords(reads: AutomatedSourceReads): AutomatedSources {
  const settings = [reads.slack, reads.discord, reads.webhooks, reads.schedules];
  if (
    reads.intake === undefined ||
    settings.some((setting) => setting.state === "unread" || setting.state === "reading")
  )
    return { kind: "reading" };
  if (settings.some((setting) => setting.state === "withheld" || setting.state === "failed"))
    return { kind: "withheld" };
  // An HQ that predates a source has none of it.
  const held = <T>(setting: SettingValue<T>) =>
    setting.state === "known" ? setting.held : undefined;
  const parts: Array<string> = [];
  if (reads.intake !== null)
    parts.push(`GitHub issues labelled “${reads.intake.label}” in ${reads.intake.repo}`);
  const slack = held(reads.slack)?.channel;
  if (slack != null) parts.push(`#${slack.channel} on Slack`);
  const discord = held(reads.discord)?.channel;
  if (discord != null) parts.push(`#${discord.channel} on Discord`);
  const webhooks = held(reads.webhooks)?.length ?? 0;
  if (webhooks > 0) parts.push(webhooks === 1 ? "a webhook" : `${String(webhooks)} webhooks`);
  const schedules = held(reads.schedules)?.length ?? 0;
  if (schedules > 0) parts.push(schedules === 1 ? "a schedule" : `${String(schedules)} schedules`);
  if (parts.length === 0) return { kind: "none" };
  return {
    kind: "named",
    words:
      parts.length === 1
        ? parts[0]!
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`,
  };
}

/**
 * The paragraph's first sentence: where their tasks come from. While the sources are read, the
 * sentence the dialog holds room for (`withheld`'s, a line long), so the paragraph never grows.
 */
export function automatedSourcesSentence(count: number, sources: AutomatedSources): string {
  const they = count === 1 ? "It" : "They";
  const takes = count === 1 ? "takes" : "take";
  switch (sources.kind) {
    case "none":
      return `No sources of tasks yet — add one on the project's page.`;
    case "named":
      return `${they} ${takes} tasks from ${sources.words}.`;
    default:
      return `${they} ${takes} tasks from the sources set on the project's page.`;
  }
}

const dollars = (amount: number) =>
  Number.isInteger(amount) ? `$${String(amount)}` : `$${amount.toFixed(2)}`;

/**
 * The provider and model automated Mates run on, as a person names them: "Nebius · GLM-5.3" — the
 * organization's pick (`HqTaskLimitsView.model`), else the default.
 */
export function automatedModelWords(picked?: string): string {
  const provider = OPENCODE_KEY_PROVIDERS.find((one) => one.id === AUTOMATED_KEY_PROVIDER);
  if (provider === undefined) return "the organization's key";
  const model =
    automatedModelOffer(automatedModelOf(picked))?.name ??
    provider.automatedModel.split("/").pop() ??
    provider.automatedModel;
  return `${provider.name.split(" ")[0] ?? provider.name} · ${model}`;
}

/**
 * What they do, in one plain paragraph: where their tasks come from — or that none is set yet,
 * and where one is added — what they run on and what one task may take, and the month's budget
 * where one is set. No sources sentence while they are read; `limits` `undefined` where not shown.
 */
export function automatedWhatTheyDo(input: {
  readonly count: number;
  readonly sources: AutomatedSources;
  readonly key: AutomatedKeyState;
  readonly limits: HqTaskLimitsView | undefined;
}): ReadonlyArray<string> {
  const they = input.count === 1 ? "It" : "They";
  const runs = input.count === 1 ? "runs" : "run";
  const sentences: Array<string> = [];
  if (input.sources.kind !== "reading")
    sentences.push(automatedSourcesSentence(input.count, input.sources));
  const model = automatedModelWords(input.limits?.model);
  const limits = input.limits;
  const perTask =
    limits === undefined
      ? ""
      : limits.costUsd === null
        ? `, at most ${String(limits.minutes)} minutes per task`
        : `, at most ${dollars(limits.costUsd)} and ${String(limits.minutes)} minutes per task`;
  sentences.push(
    input.key === "missing"
      ? `${they} ${runs} on the organization's key (${model}), which isn't set yet${perTask}.`
      : `${they} ${runs} on the organization's key (${model})${perTask}.`,
  );
  if (limits?.monthlyBudgetUsd != null)
    sentences.push(
      `${dollars(limits.spentThisMonthUsd ?? 0)} of ${dollars(limits.monthlyBudgetUsd)} spent this month.`,
    );
  return sentences;
}

/** What happens once they are added: up in minutes, then the first task waiting. */
export function automatedNext(count: number, recipe: NewMateRecipe): string {
  const they = count === 1 ? "It comes" : "They come";
  const take = count === 1 ? "takes" : "take";
  return recipe === "recipe"
    ? `${they} up in about 2–4 minutes, set${count === 1 ? "s" : ""} up development in up to 15 more, then ${take} the first task waiting.`
    : `${they} up in about 2–4 minutes and ${take} the first task waiting.`;
}

/** What they cost: each its own computer, billed by use (`newMateCost`). */
export function automatedCost(names: ReadonlyArray<string>): string {
  return names.length === 1
    ? newMateCost(names[0] ?? "")
    : "Each runs on its own computer, which Zerops bills by use while it runs.";
}
