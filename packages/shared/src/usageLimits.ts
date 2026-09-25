/**
 * Selection and pace maths for the provider limits view, shared by web and
 * mobile so both agree on which providers show, what "ahead of pace" means,
 * and how a reset is phrased.
 *
 * @module usageLimits
 */
import {
  type EnvironmentId,
  type UsageLimitsReport,
  type ProviderInstanceId,
  type ProviderConsumeResetCreditInput,
  type ServerProviderSlashCommand,
  isProviderAvailable,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
  type UsageLimitSourceSnapshot,
  type UsageLimitSourceSnapshots,
} from "@t3tools/contracts";

import * as DateTime from "effect/DateTime";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const CURSOR_USAGE_WINDOWS = [
  {
    id: "totalPercentUsed",
    label: "Overall",
    description: "Combined usage across both allowances, not a third quota.",
  },
  {
    id: "autoPercentUsed",
    label: "Cursor Models",
    description: "Grok and Composer use this first. Auto can use either pool.",
  },
  {
    id: "apiPercentUsed",
    label: "Other Models",
    description: "Claude, GPT, and Gemini use this pool. Grok and Composer fall back here.",
  },
] as const;

export function cursorUsageWindowDetails(id: string) {
  return CURSOR_USAGE_WINDOWS.find((window) => window.id === id);
}

/**
 * Providers that belong on the Limits view: enabled, installed, and one whose
 * driver reports subscription usage at all. A driver with no notion of usage
 * never sets `usageLimits`, so it has no row rather than an empty one.
 */
export function providersWithLimits(
  providers: readonly ServerProvider[],
): readonly ServerProvider[] {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      isProviderAvailable(provider) &&
      provider.usageLimits !== undefined,
  );
}

export interface LimitsGroup {
  readonly environmentId: EnvironmentId;
  /** Null while only one environment is connected; there is nothing to tell apart. */
  readonly environmentLabel: string | null;
  readonly providers: readonly ServerProvider[];
}

/**
 * One group per connected environment with a provider reporting limits.
 * Provider snapshots come from the config stream every client already holds,
 * so opening the view costs no extra request.
 */
export function collectLimitsGroups(
  presentations: ReadonlyMap<
    EnvironmentId,
    {
      readonly entry: { readonly target: { readonly label: string } };
      readonly serverConfig: { readonly providers: readonly ServerProvider[] } | null;
    }
  >,
): readonly LimitsGroup[] {
  const groups: LimitsGroup[] = [];
  for (const [environmentId, presentation] of presentations) {
    const providers = providersWithLimits(presentation.serverConfig?.providers ?? []);
    if (providers.length === 0) continue;
    groups.push({ environmentId, environmentLabel: presentation.entry.target.label, providers });
  }
  return groups.length > 1 ? groups : groups.map((group) => ({ ...group, environmentLabel: null }));
}

export interface LimitAccount {
  readonly key: string;
  readonly driver: ServerProvider["driver"];
  /** The provider whose read is shown: newest readable checkedAt among the account's environments. */
  readonly provider: ServerProvider;
  /** Where the shown read comes from; reset credits act on this environment. */
  readonly environmentId: EnvironmentId;
  /** Every environment signed in to this account, the shown read's first. */
  readonly environmentIds: readonly EnvironmentId[];
  /** The least quota left in any window of the shown read. */
  readonly urgency: number;
}

export interface LimitNoticeGroup {
  readonly driver: ServerProvider["driver"];
  readonly notice: string;
  readonly environmentIds: readonly EnvironmentId[];
}

export interface LimitAccounts {
  /** Accounts with bars to draw, the one with the least quota left first. */
  readonly accounts: readonly LimitAccount[];
  /** Accounts that could not be read, one entry per driver and notice. */
  readonly notices: readonly LimitNoticeGroup[];
}

/**
 * Quota belongs to the subscription account, not to the container it is
 * signed in on: the same account on several environments is one entry showing
 * its newest readable read, never a merge of reads taken at different times.
 * A failed read hides nothing another container read successfully; the account
 * becomes a notice only when none of its reads is readable. A provider without
 * an email is an account of its own.
 */
export function collectLimitAccounts(
  presentations: ReadonlyMap<
    EnvironmentId,
    { readonly serverConfig: { readonly providers: readonly ServerProvider[] } | null }
  >,
): LimitAccounts {
  const byKey = new Map<
    string,
    Array<{
      readonly environmentId: EnvironmentId;
      readonly provider: ServerProvider;
      readonly limits: ServerProviderUsageLimits;
    }>
  >();
  for (const [environmentId, presentation] of presentations) {
    for (const provider of providersWithLimits(presentation.serverConfig?.providers ?? [])) {
      if (!provider.usageLimits) continue;
      const key =
        accountKey(provider.driver, provider.auth.email) ??
        `${environmentId}:${provider.instanceId}`;
      const reads = byKey.get(key) ?? [];
      reads.push({ environmentId, provider, limits: provider.usageLimits });
      byKey.set(key, reads);
    }
  }
  const accounts: LimitAccount[] = [];
  const notices = new Map<string, LimitNoticeGroup>();
  for (const [key, reads] of byKey) {
    const readable = reads.filter((read) => limitsNotice(read.limits) === null);
    const shown = (readable.length > 0 ? readable : reads).reduce((newest, read) =>
      checkedAtMillis(read.limits) > checkedAtMillis(newest.limits) ? read : newest,
    );
    const environmentIds = [
      ...new Set([shown.environmentId, ...reads.map((read) => read.environmentId)]),
    ];
    const notice = limitsNotice(shown.limits);
    if (notice === null) {
      accounts.push({
        key,
        driver: shown.provider.driver,
        provider: shown.provider,
        environmentId: shown.environmentId,
        environmentIds,
        urgency: Math.min(...shown.limits.windows.map(remainingPercent)),
      });
      continue;
    }
    const noticeKey = `${shown.provider.driver}\n${notice}`;
    const group = notices.get(noticeKey);
    notices.set(noticeKey, {
      driver: shown.provider.driver,
      notice,
      environmentIds: [...new Set([...(group?.environmentIds ?? []), ...environmentIds])],
    });
  }
  accounts.sort((a, b) => a.urgency - b.urgency);
  return { accounts, notices: [...notices.values()] };
}

function checkedAtMillis(limits: ServerProviderUsageLimits): number {
  const at = Date.parse(limits.checkedAt);
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
}

/**
 * Every usage-limit source across connected environments, keyed so two
 * environments pointing at the same hub still get their own rows. The label
 * carries the environment only when more than one environment has sources.
 * A native provider with usable limits takes precedence over the same account
 * in a source, even when it belongs to another connected environment.
 */
export function collectLimitSources(
  presentations: ReadonlyMap<
    EnvironmentId,
    {
      readonly entry: { readonly target: { readonly label: string } };
      readonly serverConfig: {
        readonly providers?: readonly ServerProvider[] | undefined;
        readonly usageLimitSources?: UsageLimitSourceSnapshots | undefined;
      } | null;
    }
  >,
): ReadonlyArray<
  UsageLimitSourceSnapshot & {
    readonly key: string;
    readonly environmentId: EnvironmentId;
    readonly hiddenAccountCount: number;
  }
> {
  const nativeAccounts = new Set<string>();
  for (const presentation of presentations.values()) {
    for (const provider of providersWithLimits(presentation.serverConfig?.providers ?? [])) {
      const key = accountKey(provider.driver, provider.auth.email);
      if (
        key !== null &&
        provider.usageLimits?.windows.length &&
        !provider.usageLimits.unavailable
      ) {
        nativeAccounts.add(key);
      }
    }
  }
  const perEnvironment: Array<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
    readonly sources: UsageLimitSourceSnapshots;
  }> = [];
  for (const [environmentId, presentation] of presentations) {
    const sources = presentation.serverConfig?.usageLimitSources ?? [];
    if (sources.length === 0) continue;
    perEnvironment.push({
      environmentId,
      environmentLabel: presentation.entry.target.label,
      sources,
    });
  }
  const labelEnvironment = perEnvironment.length > 1;
  return perEnvironment.flatMap(({ environmentId, environmentLabel, sources }) =>
    sources.map((source) => {
      const accounts = source.accounts.filter((account) => {
        const key = accountKey(account.driver, account.email);
        return key === null || !nativeAccounts.has(key);
      });
      return {
        ...source,
        accounts,
        hiddenAccountCount: source.accounts.length - accounts.length,
        environmentId,
        key: `${environmentId}:${source.id}`,
        label: labelEnvironment ? `${environmentLabel} · ${source.label}` : source.label,
      };
    }),
  );
}

function accountKey(driver: ServerProvider["driver"], email: string | undefined): string | null {
  const normalizedEmail = email?.trim().toLowerCase();
  return normalizedEmail ? `${driver}:${normalizedEmail}` : null;
}

/** The instance's configured name, else the driver's, else its raw kind. */
export function providerLimitsLabel(
  provider: Pick<ServerProvider, "driver" | "displayName">,
  driverLabel: (driver: ServerProvider["driver"]) => string | undefined,
): string {
  return provider.displayName?.trim() || driverLabel(provider.driver) || String(provider.driver);
}

const LIMITS_UNREADABLE = "Could not read limits.";

/** The one-line status under a provider heading when there are no bars to draw. */
export function limitsNotice(limits: ServerProviderUsageLimits): string | null {
  if (limits.unavailable?.reason === "unsupported") {
    return limits.unavailable.message ?? "This account has no subscription limits.";
  }
  if (limits.unavailable?.reason === "probeFailed") {
    return limits.unavailable.message ?? LIMITS_UNREADABLE;
  }
  return limits.windows.length === 0 ? "No limits reported." : null;
}

/**
 * One muted line for a notice shared by several places: `Codex limits couldn't
 * be read on Juno and Nova.`, or the driver's own message after the places.
 * A place named twice is said once.
 */
export function limitsNoticeLine(input: {
  readonly driverLabel: string;
  readonly notice: string;
  readonly places: readonly string[];
}): string {
  const places = [...new Set(input.places)];
  const last = places.at(-1);
  const where =
    last === undefined
      ? ""
      : places.length === 1
        ? ` on ${last}`
        : ` on ${places.slice(0, -1).join(", ")} and ${last}`;
  return input.notice === LIMITS_UNREADABLE
    ? `${input.driverLabel} limits couldn't be read${where}.`
    : `${input.driverLabel}${where}: ${input.notice}`;
}

/** Quota left in the window, 0..100. Bars and labels show what remains, as Codex does. */
export function remainingPercent(window: ServerProviderUsageWindow): number {
  return Math.round(100 - Math.max(0, Math.min(100, window.usedPercent)));
}

function resetMillis(window: ServerProviderUsageWindow): number | null {
  if (window.resetsAt === undefined) return null;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) ? at : null;
}

/** Elapsed share of the window, 0..1, or null when its length or reset is unknown. */
export function elapsedShare(window: ServerProviderUsageWindow, now: number): number | null {
  const resetsAt = resetMillis(window);
  if (resetsAt === null || window.windowDurationMins === undefined) return null;
  const length = window.windowDurationMins * MINUTE;
  if (length <= 0) return null;
  return Math.max(0, Math.min(1, (length - (resetsAt - now)) / length));
}

export type LimitPace = "ahead" | "on" | "under";

/**
 * Usage against the clock. Spending evenly leaves the same share of quota as
 * there is time left in the window; within five points of that counts as on
 * pace, further ahead means the window may run dry first.
 */
export function paceOf(window: ServerProviderUsageWindow, now: number): LimitPace | null {
  const elapsed = elapsedShare(window, now);
  if (elapsed === null) return null;
  const gap = window.usedPercent - elapsed * 100;
  if (gap > 5) return "ahead";
  if (gap < -5) return "under";
  return "on";
}

/** `2h 13m`, `3d 4h`, `12m`. */
export function formatDuration(ms: number): string {
  const remaining = Math.max(0, ms);
  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** `resets in 2h 13m`, or null when the window has no reset. */
export function formatResetsIn(window: ServerProviderUsageWindow, now: number): string | null {
  const resetsAt = resetMillis(window);
  if (resetsAt === null) return null;
  return resetsAt <= now ? "resets now" : `resets in ${formatDuration(resetsAt - now)}`;
}

/** Limit commands are served by T3 from the same snapshots as Usage → Limits. */
export const USAGE_LIMITS_COMMAND = {
  name: "usage-limits",
  description: "Show this provider's usage limits",
} satisfies ServerProviderSlashCommand;

/** Handled by the client without sending a turn; anything with arguments stays an ordinary prompt. */
export function isUsageLimitsCommand(prompt: string): boolean {
  return prompt.trim().toLowerCase() === "/usage-limits";
}

/**
 * Whether Limits has anything to say about this driver. A source that failed to
 * read keeps no accounts, so its error counts for every driver rather than
 * disappearing until the next successful refresh.
 */
export function hasProviderUsageLimits(
  driver: ServerProvider["driver"],
  providers: readonly ServerProvider[],
  sources: UsageLimitSourceSnapshots,
): boolean {
  return (
    providersWithLimits(providers).some((provider) => provider.driver === driver) ||
    sources.some(
      (source) =>
        source.accounts.some((account) => account.driver === driver) ||
        (source.error !== undefined && source.accounts.length === 0),
    )
  );
}

/**
 * The drivers a set of sources would offer the command to, where a source that
 * failed to read counts for every driver. Two snapshots with the same coverage
 * need no catalog republish, however much their quotas moved.
 */
export function sameUsageLimitCommandCoverage(
  previous: UsageLimitSourceSnapshots,
  next: UsageLimitSourceSnapshots,
): boolean {
  const coverage = (sources: UsageLimitSourceSnapshots) =>
    new Set(
      sources.flatMap((source) =>
        source.error !== undefined && source.accounts.length === 0
          ? ["*"]
          : source.accounts.map((account) => String(account.driver)),
      ),
    );
  const before = coverage(previous);
  const after = coverage(next);
  return before.size === after.size && [...before].every((driver) => after.has(driver));
}

/** Advertise on workspace catalogs too, which replace the global command list. */
export function withUsageLimitsCommands(
  providers: readonly ServerProvider[],
  sources: UsageLimitSourceSnapshots,
): ServerProvider[] {
  return providers.map((provider) => {
    if (!hasProviderUsageLimits(provider.driver, providers, sources)) return provider;
    const commands = (items: readonly ServerProviderSlashCommand[]) => [
      ...items.filter((command) => command.name !== USAGE_LIMITS_COMMAND.name),
      USAGE_LIMITS_COMMAND,
    ];
    return {
      ...provider,
      slashCommands: commands(provider.slashCommands),
      ...(provider.workspaceSnapshots
        ? {
            workspaceSnapshots: provider.workspaceSnapshots.map((snapshot) => ({
              ...snapshot,
              slashCommands: commands(snapshot.slashCommands),
            })),
          }
        : {}),
    };
  });
}

/** A point-in-time report; never refreshes or guesses which pooled account serves a turn. */
export function collectProviderUsageLimits(
  instanceId: ProviderInstanceId,
  providers: readonly ServerProvider[],
  sources: UsageLimitSourceSnapshots,
  now: number,
): UsageLimitsReport | null {
  const selected = providers.find((provider) => provider.instanceId === instanceId);
  if (!selected || !hasProviderUsageLimits(selected.driver, providers, sources)) return null;
  const native = providersWithLimits(providers).filter(
    (provider) => provider.driver === selected.driver,
  );
  const nativeAccounts = new Set(
    native.flatMap((provider) => {
      const key = accountKey(provider.driver, provider.auth.email);
      return key && provider.usageLimits?.windows.length && !provider.usageLimits.unavailable
        ? [key]
        : [];
    }),
  );
  const accounts: Array<UsageLimitsReport["accounts"][number]> = [];
  const notices: string[] = [];
  for (const provider of native) {
    if (!provider.usageLimits) continue;
    const key = accountKey(provider.driver, provider.auth.email);
    const hubCredits = sources
      .flatMap((source) => source.accounts.map((account) => ({ source, account })))
      .filter(
        ({ account }) =>
          key !== null &&
          accountKey(account.driver, account.email) === key &&
          account.usageLimits.resetCredits &&
          !limitsNotice(account.usageLimits),
      )
      .sort(
        (a, b) =>
          Date.parse(b.account.usageLimits.checkedAt) - Date.parse(a.account.usageLimits.checkedAt),
      )[0];
    const useHubCredits =
      hubCredits &&
      (!provider.usageLimits.resetCredits ||
        Date.parse(hubCredits.account.usageLimits.checkedAt) >
          Date.parse(provider.usageLimits.checkedAt));
    const hubCreditId = useHubCredits
      ? hubCredits.account.usageLimits.resetCredits?.nextCreditId
      : undefined;
    accounts.push({
      id: provider.instanceId,
      driver: provider.driver,
      label: `${providerLimitsLabel(provider, () => undefined)} [${provider.instanceId}]`,
      ...(provider.auth.label ? { plan: provider.auth.label } : {}),
      instanceId: provider.instanceId,
      resetCreditInput:
        hubCreditId && hubCredits
          ? {
              sourceId: hubCredits.source.id,
              accountId: hubCredits.account.id,
              creditId: hubCreditId,
            }
          : { instanceId: provider.instanceId },
      ...(provider.displayName ? { displayName: provider.displayName } : {}),
      ...(provider.accentColor ? { accentColor: provider.accentColor } : {}),
      ...(provider.auth.email ? { email: provider.auth.email } : {}),
      limits: useHubCredits
        ? { ...provider.usageLimits, resetCredits: hubCredits.account.usageLimits.resetCredits }
        : provider.usageLimits,
    });
  }
  for (const source of sources) {
    const matching = source.accounts.filter((account) => account.driver === selected.driver);
    for (const account of matching) {
      const key = accountKey(account.driver, account.email);
      if (key && nativeAccounts.has(key)) continue;
      accounts.push({
        id: `${source.id}:${account.id}`,
        driver: account.driver,
        label: `${source.label} · ${account.id}`,
        sourceLabel: "CLI Proxy",
        ...(account.usageLimits.resetCredits?.nextCreditId
          ? {
              resetCreditInput: {
                sourceId: source.id,
                accountId: account.id,
                creditId: account.usageLimits.resetCredits.nextCreditId,
              },
            }
          : {}),
        ...(account.plan ? { plan: account.plan } : {}),
        ...(account.email ? { email: account.email } : {}),
        limits: account.usageLimits,
      });
    }
    // A source that failed to read has no accounts left to match on, so its
    // error is reported to every provider rather than silently dropped.
    if (source.error && (matching.length > 0 || source.accounts.length === 0)) {
      notices.push(`${source.label}: ${source.error}`);
    }
  }
  return { createdAt: DateTime.formatIso(DateTime.makeUnsafe(now)), accounts, notices };
}
