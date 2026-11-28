import { InlineButton } from "../ui/button";
import {
  type EnvironmentId,
  type ProviderConsumeResetCreditOutcome,
  ProviderConsumeResetCreditInput,
  ServerProvider,
  ServerProviderResetCredits,
  ServerProviderUsageWindow,
  UsageLimitSourceAccount,
  UsageLimitSourceSnapshot,
  UsageProviderKind,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  type collectLimitSources,
  elapsedShare,
  formatDuration,
  formatResetsIn,
  type LimitAccount,
  limitsNotice,
  limitsNoticeLine,
  type LimitsEntry,
  type LimitsPresentation,
  limitsPage,
  type LimitPace,
  paceOf,
  providerLimitsLabel,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { GaugeIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import type {
  UsageEnvironmentIdentities,
  UsageEnvironmentOwner,
} from "../../zerops/usageEnvironmentIdentities";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getDriverOption } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PersonAvatar } from "../zerops/primitives";
import { Loading } from "../ui/loading";
import { Meter } from "../ui/meter";
import { Skeleton } from "../ui/skeleton";
import { WaitLine } from "../zerops/WaitLine";
import { useWaitLine } from "~/zerops/useWaitLine";
import { BOOT_WAIT_LINE_MS } from "~/zerops/waitLine.logic";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { Text } from "~/components/ui/text";

const PACE: Record<LimitPace, { readonly label: string; readonly icon: typeof GaugeIcon }> = {
  ahead: { label: "Spending ahead of pace", icon: TrendingUpIcon },
  on: { label: "Spending on pace", icon: GaugeIcon },
  under: { label: "Spending under pace", icon: TrendingDownIcon },
};

/** The series colour the cost chart uses for this driver, so the two views read as one. */
function barColor(driver: ServerProvider["driver"]): string {
  const kind: UsageProviderKind | undefined =
    driver === "codex" ? "codex" : driver === "claudeAgent" ? "claude" : undefined;
  return kind ? PROVIDER_PRESENTATION[kind].color : "var(--foreground)";
}

/** Pace as a glyph with the words on hover. */
function PaceIcon({ pace }: { readonly pace: LimitPace }) {
  const Icon = PACE[pace].icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={PACE[pace].label}
            className="inline-flex text-muted-foreground"
          />
        }
      >
        <Icon className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipPopup side="top">{PACE[pace].label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * One window as a full-width bar from the moment it opened to its reset.
 * The fill is the share of quota spent; the hairline is how far into the
 * window the clock is, which is also where even spending would have put the
 * fill. Hover for the exact figures and reset time.
 */
function WindowBar({
  color,
  window,
  now,
}: {
  readonly color: string;
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const remaining = remainingPercent(window);
  const elapsed = elapsedShare(window, now);
  // The fill is quota left, so the even-spending mark is the time left.
  const timeLeft = elapsed === null ? null : Math.round((1 - elapsed) * 100);
  const resetsIn = formatResetsIn(window, now);
  const resetsAt = window.resetsAt
    ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)
    : null;
  const summary = `${window.label}: ${remaining}% left${
    timeLeft === null ? "" : `, ${timeLeft}% of the window left`
  }${resetsIn ? `, ${resetsIn}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="img"
            aria-label={summary}
            tabIndex={0}
            className="flex h-6 cursor-default items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        }
      >
        <Meter
          color={color}
          marker={timeLeft === null ? null : timeLeft / 100}
          size="lg"
          value={remaining / 100}
        />
      </TooltipTrigger>
      <TooltipPopup variant="rich" side="top">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">
            {remaining}% left{timeLeft !== null ? ` · ${timeLeft}% of the window left` : ""}
          </span>
          {timeLeft !== null ? (
            <span className="text-muted-foreground">The line is where even spending would be.</span>
          ) : null}
          {resetsAt ? (
            <span className="text-muted-foreground">
              Resets {resetsAt}
              {resetsIn ? ` · ${resetsIn}` : ""}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * One account's windows as rows: label and percent, bar, pace and countdown.
 * Compact rows fit the composer panel with narrower columns.
 */
export function LimitWindows({
  driver,
  windows,
  now,
  compact = false,
}: {
  readonly driver: ServerProvider["driver"];
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly now: number;
  readonly compact?: boolean;
}) {
  const color = barColor(driver);
  return (
    <div
      className={
        compact
          ? "grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] gap-x-3 gap-y-0.5"
          : // On a phone the fixed columns would leave the bar 30 px: it takes the compact ones.
            "grid grid-cols-[11rem_minmax(0,1fr)_7rem] gap-x-4 gap-y-1 max-sm:grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] max-sm:gap-x-3"
      }
    >
      {windows.map((window) => {
        const pace = paceOf(window, now);
        const resetsIn = formatResetsIn(window, now);
        return (
          <Fragment key={window.id}>
            <span className="flex min-w-0 items-center gap-2 text-caption">
              <span className="truncate text-muted-foreground">{window.label}</span>
              <span className="ms-auto shrink-0 font-medium text-foreground tabular-nums">
                {remainingPercent(window)}% left
              </span>
            </span>
            <WindowBar color={color} window={window} now={now} />
            <Text className="flex items-center gap-2 whitespace-nowrap" variant="meta">
              {pace ? <PaceIcon pace={pace} /> : null}
              <span className="ms-auto shrink-0">{resetsIn ?? ""}</span>
            </Text>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * One account while the limits are read, in `AccountLimits`' own boxes — its heading's line and two
 * windows' rows — so the account paints where its stand-in stood.
 */
function AccountLimitsStandIn() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-5 items-center gap-2">
        <Skeleton className="size-5 shrink-0" shape="pill" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="grid grid-cols-[11rem_minmax(0,1fr)_7rem] gap-x-4 gap-y-1 max-sm:grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] max-sm:gap-x-3">
        {[0, 1].map((row) => (
          <Fragment key={row}>
            <span className="flex h-6 items-center">
              <Skeleton className="h-3 w-full" />
            </span>
            <span className="flex h-6 items-center">
              <Skeleton className="h-3 w-full" shape="pill" />
            </span>
            <span />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Heading shared by local providers and source accounts: icon, driver, instance, plan,
 * and the signed-in email blurred until clicked, as provider settings do.
 */
function AccountHeading({
  driver,
  label,
  instanceLabel,
  plan,
  email,
  accentColor,
}: {
  readonly driver: ServerProvider["driver"];
  readonly label: string;
  readonly instanceLabel: string;
  readonly plan: string | undefined;
  readonly email: string | undefined;
  readonly accentColor?: string | undefined;
}) {
  return (
    <Text
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      render={<h2 />}
      variant="heading"
    >
      <ProviderInstanceIcon
        driverKind={driver}
        displayName={instanceLabel}
        accentColor={accentColor}
        showBadge={Boolean(accentColor)}
        indicatorBackground="var(--background)"
        className="size-5"
        iconClassName="size-4 text-foreground/80"
      />
      <span className="truncate">{label}</span>
      {instanceLabel !== label ? (
        <span className="min-w-0 truncate text-caption font-normal text-muted-foreground">
          ·{" "}
          {instanceLabel.includes("@") ? (
            <RedactedSensitiveText
              key={instanceLabel}
              value={instanceLabel}
              ariaLabel="Toggle account label visibility"
              revealTooltip="Click to reveal account"
              hideTooltip="Click to hide account"
            />
          ) : (
            instanceLabel
          )}
        </span>
      ) : null}
      {plan ? <span className="font-normal text-muted-foreground">· {plan}</span> : null}
      {email ? (
        <RedactedSensitiveText
          value={email}
          ariaLabel="Toggle account email visibility"
          revealTooltip="Click to reveal email"
          hideTooltip="Click to hide email"
        />
      ) : null}
    </Text>
  );
}

/**
 * Where an account is signed in, as the left menu names it: the Mate and its
 * project, or the environment's own label outside Zerops.
 */
export function limitsPlaceName(
  environmentId: EnvironmentId,
  identities: UsageEnvironmentIdentities,
  label: string,
): string {
  const identity = identities.get(environmentId);
  if (!identity) return label;
  return identity.projectName
    ? `${identity.mateName} · ${identity.projectName}`
    : identity.mateName;
}

interface LimitsPlace {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly owner: UsageEnvironmentOwner | null;
}

/** The Mates signed in to one account, each with its owner's face when known. */
function PlaceChips({ places }: { readonly places: readonly LimitsPlace[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Signed in on">
      {places.map((place) => (
        <Badge className="max-w-full" key={place.environmentId} render={<li />}>
          {place.owner ? (
            <PersonAvatar name={place.owner.name} picture={place.owner.avatarUrl} size={16} />
          ) : null}
          <span className="truncate">{place.name}</span>
          {place.owner ? <span className="sr-only">{`, ${place.owner.name}'s Mate`}</span> : null}
        </Badge>
      ))}
    </ul>
  );
}

/**
 * One subscription account, however many Mates are signed in to it: the
 * newest readable read's windows, and its reset credits acting on the
 * environment that read came from.
 */
function AccountLimits({
  account,
  places,
  now,
}: {
  readonly account: LimitAccount;
  /** Null while only one environment is connected; there is nothing to tell apart. */
  readonly places: readonly LimitsPlace[] | null;
  readonly now: number;
}) {
  const { provider } = account;
  const limits = provider.usageLimits;
  if (!limits) return null;
  return (
    <section className="flex flex-col gap-3">
      <AccountHeading
        driver={provider.driver}
        label={getDriverOption(provider.driver)?.label ?? String(provider.driver)}
        instanceLabel={providerLimitsLabel(provider, (driver) => getDriverOption(driver)?.label)}
        plan={provider.auth.label}
        email={provider.auth.email}
        accentColor={provider.accentColor}
      />
      {places ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PlaceChips places={places} />
          {places.length > 1 ? <Text variant="note">newest of {places.length} reads</Text> : null}
        </div>
      ) : null}
      <LimitWindows driver={provider.driver} windows={limits.windows} now={now} />
      {limits.resetCredits ? (
        <ResetCredits
          environmentId={account.environmentId}
          input={{ instanceId: provider.instanceId }}
          credits={limits.resetCredits}
          now={now}
        />
      ) : null}
    </section>
  );
}

const OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

/**
 * Banked reset credits with a confirmed redeem action. Redeeming spends a
 * credit the provider granted the user, so it never fires on a bare click.
 */
export function ResetCredits({
  environmentId,
  input,
  credits,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
  readonly credits: ServerProviderResetCredits;
  readonly now: number;
}) {
  const consume = useAtomCommand(serverEnvironment.consumeResetCredit, { reportFailure: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  if (credits.availableCount === 0 && status === null) return null;

  const expiresIn = credits.nextExpiresAt
    ? formatDuration(Date.parse(credits.nextExpiresAt) - now)
    : null;
  const summary =
    credits.availableCount === 0
      ? "No reset credits banked"
      : `${credits.availableCount} ${credits.availableCount === 1 ? "reset credit" : "reset credits"} banked${
          expiresIn ? ` · next expires in ${expiresIn}` : ""
        }`;

  const redeem = async () => {
    setConfirming(false);
    setBusy(true);
    setStatus(null);
    const result = await consume({ environmentId, input });
    setBusy(false);
    if (result._tag === "Success") {
      setStatus(result.value.warning ?? OUTCOME_TEXT[result.value.outcome]);
      return;
    }
    setStatus(
      "error" in result.cause && result.cause.error instanceof Error
        ? result.cause.error.message
        : "Could not use the reset credit.",
    );
  };

  return (
    <Text className="flex flex-wrap items-center gap-x-3 gap-y-1" render={<div />} variant="note">
      <span className="tabular-nums">{summary}</span>
      {credits.availableCount > 0 ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
          {busy ? "Using…" : "Use reset"}
        </Button>
      ) : null}
      {status ? <span className="text-foreground">{status}</span> : null}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Use a reset credit?</AlertDialogTitle>
            <AlertDialogDescription>
              This redeems one credit on your account and clears the current rate-limit windows. It
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
            <Button onClick={() => void redeem()}>Use credit</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Text>
  );
}

/** One account pooled by a usage-limit source, drawn like a provider row. */
function SourceAccountLimits({
  account,
  sourceKind,
  source,
  now,
}: {
  readonly account: UsageLimitSourceAccount;
  readonly sourceKind: string;
  readonly source: Pick<LimitsSource, "id" | "environmentId">;
  readonly now: number;
}) {
  const credits = account.usageLimits.resetCredits;
  const notice = limitsNotice(account.usageLimits);
  return (
    <section className="flex flex-col gap-3">
      <AccountHeading
        driver={account.driver}
        label={getDriverOption(account.driver)?.label ?? String(account.driver)}
        instanceLabel={sourceKind}
        plan={account.plan}
        email={account.email}
      />
      {notice ? (
        <Text variant="note">{notice}</Text>
      ) : (
        <LimitWindows driver={account.driver} windows={account.usageLimits.windows} now={now} />
      )}
      {credits?.nextCreditId ? (
        <ResetCredits
          environmentId={source.environmentId}
          input={{ sourceId: source.id, accountId: account.id, creditId: credits.nextCreditId }}
          credits={credits}
          now={now}
        />
      ) : null}
    </section>
  );
}

const SOURCE_KIND_LABEL: Record<UsageLimitSourceSnapshot["kind"], string> = {
  cliproxy: "CLI Proxy",
};

type LimitsSource = ReturnType<typeof collectLimitSources>[number];

/** Read-only accounts pooled by a configured usage source. */
function SourceLimits({ source, now }: { readonly source: LimitsSource; readonly now: number }) {
  const kind = SOURCE_KIND_LABEL[source.kind];
  return (
    <div className="flex flex-col gap-6">
      {source.error ? (
        <Text variant="note">{source.error}</Text>
      ) : source.accounts.length === 0 ? (
        <Text variant="note">
          {source.hiddenAccountCount > 0
            ? "All accounts are shown by connected providers."
            : "No accounts reported."}
        </Text>
      ) : (
        source.accounts.map((account) => (
          <SourceAccountLimits
            key={account.id}
            account={account}
            sourceKind={kind}
            source={source}
            now={now}
          />
        ))
      )}
    </div>
  );
}

/** What the limits say while an environment's read is still on its way. */
export const READING_LIMITS_LINE = "Reading subscription limits…";

/**
 * Subscription quota windows from every connected environment's providers.
 * The page supplies the shared clock. The cards appear as answers arrive, least quota left first;
 * then they stand as painted, a late answer joining at the end, the reading
 * line under them while one is still on its way.
 */
export function UsageLimitsSection({
  now,
  identities,
  listed,
  environmentIds,
  unavailableNames = [],
  onRetry,
}: {
  readonly now: number;
  readonly identities: UsageEnvironmentIdentities;
  /** The environments are listed whole: none is still to be registered. */
  readonly listed: boolean;
  readonly environmentIds?: ReadonlySet<EnvironmentId> | undefined;
  readonly unavailableNames?: readonly string[] | undefined;
  readonly onRetry?: () => void;
}) {
  const available = useAtomValue(environmentPresentations.presentationsAtom);
  const presentations = new Map<EnvironmentId, LimitsPresentation>(
    [...available].filter(([id]) => environmentIds === undefined || environmentIds.has(id)),
  );
  for (const id of environmentIds ?? []) {
    if (!presentations.has(id))
      presentations.set(id, {
        entry: { target: { label: identities.get(id)?.mateName ?? String(id) } },
        connection: { phase: "offline", error: null },
        serverConfig: null,
      });
  }
  // Keep presentation order while each source answers independently.
  const [placed, setPlaced] = useState<readonly string[]>([]);
  const page = limitsPage({
    listed,
    presentations,
    placed,
  });
  const { state, reading, entries, tellApart } = page;
  if (page.placed.join("\n") !== placed.join("\n")) {
    setPlaced(page.placed);
  }
  // One beat from the section's mount for the whole reading, the page's line and the cards' alike.
  const readingLine = useWaitLine(reading ? READING_LIMITS_LINE : null, {
    delayMs: BOOT_WAIT_LINE_MS,
    from: "mount",
  });
  const placesOf = (environmentIds: readonly EnvironmentId[]): readonly LimitsPlace[] =>
    environmentIds.map((environmentId) => ({
      environmentId,
      name: limitsPlaceName(
        environmentId,
        identities,
        presentations.get(environmentId)?.entry.target.label ?? String(environmentId),
      ),
      owner: identities.get(environmentId)?.owner ?? null,
    }));

  if (state === "wait") {
    return (
      <Loading label={READING_LIMITS_LINE}>
        <AccountLimitsStandIn />
      </Loading>
    );
  }
  if (state === "unavailable" || (state === "none" && unavailableNames.length > 0)) {
    return (
      <Text render={<p />} variant="description">
        Subscription limits could not be read from every Mate.
        {onRetry === undefined ? null : (
          <>
            {" "}
            <InlineButton onClick={onRetry}>Try again</InlineButton>
          </>
        )}
      </Text>
    );
  }
  if (state === "none") {
    return (
      <div className="flex flex-col gap-8">
        <Text render={<p />} variant="description">
          No coding agent on your connected Mates reports subscription limits.
        </Text>
        {readingLine ? <WaitLine text={READING_LIMITS_LINE} /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {entryBlocks(entries).map((block) =>
        block.kind === "notices" ? (
          <div className="flex flex-col gap-1" key={block.key}>
            {block.notices.map((group) => (
              <Text render={<p />} variant="note" key={`${group.driver}:${group.notice}`}>
                {limitsNoticeLine({
                  driverLabel: getDriverOption(group.driver)?.label ?? String(group.driver),
                  notice: group.notice,
                  places: tellApart
                    ? placesOf(group.environmentIds).map((place) => place.name)
                    : [],
                })}
              </Text>
            ))}
          </div>
        ) : block.entry.kind === "account" ? (
          <AccountLimits
            key={block.key}
            account={block.entry.account}
            places={tellApart ? placesOf(block.entry.account.environmentIds) : null}
            now={now}
          />
        ) : block.entry.kind === "source" ? (
          <SourceLimits key={block.key} source={block.entry.source} now={now} />
        ) : null,
      )}
      {page.unread.length > 0 || unavailableNames.length > 0 ? (
        <Text render={<p />} variant="note">
          Limits unavailable from{" "}
          {[...unavailableNames, ...placesOf(page.unread).map((place) => place.name)].join(", ")}.
          Values from these Mates are not included.
        </Text>
      ) : null}
      {/* Under the cards while more are on their way: a late answer joins above it, at the end. */}
      {readingLine ? <WaitLine text={READING_LIMITS_LINE} /> : null}
    </div>
  );
}

type EntryBlock =
  | { readonly kind: "entry"; readonly key: string; readonly entry: LimitsEntry }
  | {
      readonly kind: "notices";
      readonly key: string;
      readonly notices: ReadonlyArray<Extract<LimitsEntry, { kind: "notice" }>["notice"]>;
    };

/** The entries in their order, a run of notices drawn as one tight block of lines. */
function entryBlocks(entries: readonly LimitsEntry[]): readonly EntryBlock[] {
  const blocks: EntryBlock[] = [];
  for (const entry of entries) {
    const last = blocks.at(-1);
    if (entry.kind !== "notice") blocks.push({ kind: "entry", key: entry.key, entry });
    else if (last?.kind === "notices") {
      blocks[blocks.length - 1] = { ...last, notices: [...last.notices, entry.notice] };
    } else blocks.push({ kind: "notices", key: entry.key, notices: [entry.notice] });
  }
  return blocks;
}
