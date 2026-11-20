/**
 * An instance's workspace snapshots: the commands and skills of each folder
 * its agent was scanned in or ran a session in, beside the machine snapshot.
 */
import type { ServerProvider, ServerProviderSlashCommand } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ProviderWorkspaceSnapshot } from "./ProviderDriver.ts";
import { COMPACT_SLASH_COMMAND } from "./providerSnapshot.ts";
import type { ServerProviderShape } from "./Services/ServerProvider.ts";

type WorkspaceSnapshots = NonNullable<ServerProvider["workspaceSnapshots"]>;

/** What a folder's scan found, when it reads commands (Claude) and not only skills (Cursor). */
export interface ScannedWorkspaceCommands {
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly slashCommandsPending?: boolean | undefined;
}

/**
 * Holds the instance's workspace snapshots so they stay scoped to their folder
 * across health refreshes: every machine publish carries them.
 */
export const makeWorkspaceCommandCatalog = Effect.fn("makeWorkspaceCommandCatalog")(function* (
  provider: ServerProviderShape,
) {
  const workspaces = yield* SubscriptionRef.make<WorkspaceSnapshots>([]);
  const getSnapshot = Effect.all([provider.getSnapshot, SubscriptionRef.get(workspaces)]).pipe(
    Effect.map(([snapshot, workspaceSnapshots]) =>
      workspaceSnapshots.length > 0 ? { ...snapshot, workspaceSnapshots } : snapshot,
    ),
  );
  /**
   * A scan's result. Commands it did not bring (none read, or still pending)
   * keep the folder's commands, else the machine's.
   */
  const snapshotForCwd = Effect.fn("WorkspaceCommandCatalog.snapshotForCwd")(function* (
    cwd: string,
    skills: ServerProvider["skills"],
    scanned?: ScannedWorkspaceCommands,
  ) {
    const machineSnapshot = yield* provider.getSnapshot;
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const slashCommandsPending = scanned?.slashCommandsPending === true;
    yield* SubscriptionRef.update(workspaces, (entries) =>
      [
        ...entries.filter((entry) => entry.cwd !== cwd),
        {
          cwd,
          checkedAt,
          slashCommands:
            scanned && !slashCommandsPending
              ? scanned.slashCommands
              : (entries.find((entry) => entry.cwd === cwd)?.slashCommands ??
                machineSnapshot.slashCommands),
          ...(slashCommandsPending ? { slashCommandsPending } : {}),
          skills,
        },
      ].slice(-16),
    );
    const snapshot = yield* getSnapshot;
    return {
      ...snapshot,
      checkedAt,
      slashCommands:
        snapshot.workspaceSnapshots?.find((entry) => entry.cwd === cwd)?.slashCommands ??
        snapshot.slashCommands,
      ...(slashCommandsPending ? { slashCommandsPending } : {}),
      skills,
    } satisfies ProviderWorkspaceSnapshot;
  });
  /** A session's own list for its folder replaces whatever a scan found there. */
  const onWorkspaceCommands = Effect.fn("WorkspaceCommandCatalog.onWorkspaceCommands")(function* (
    commands: ReadonlyArray<ServerProviderSlashCommand>,
    cwd: string,
    skills: ServerProvider["skills"],
  ) {
    const seen = new Set([COMPACT_SLASH_COMMAND.name]);
    const slashCommands = [
      COMPACT_SLASH_COMMAND,
      ...commands.filter((command) => {
        if (seen.has(command.name)) return false;
        seen.add(command.name);
        return true;
      }),
    ];
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    yield* SubscriptionRef.update(workspaces, (entries) =>
      [
        ...entries.filter((entry) => entry.cwd !== cwd),
        { cwd, checkedAt, slashCommands, skills },
      ].slice(-16),
    );
  });
  return {
    onWorkspaceCommands,
    snapshotForCwd,
    snapshot: {
      ...provider,
      getSnapshot,
      refresh: provider.refresh.pipe(Effect.andThen(getSnapshot)),
      streamChanges: Stream.merge(
        provider.streamChanges.pipe(Stream.map(() => undefined)),
        SubscriptionRef.changes(workspaces).pipe(Stream.map(() => undefined)),
      ).pipe(Stream.mapEffect(() => getSnapshot)),
    } satisfies ServerProviderShape,
  };
});

const slashCommandNames = (provider: ServerProvider) =>
  provider.slashCommands.map((command) => command.name).join("\n");

/**
 * The folders whose commands did not come and are worth scanning again: the
 * agent's install, version, enabled state, status, sign-in or machine commands
 * changed between two snapshots of one instance. A change of usage or check
 * time alone scans nothing again.
 */
export function pendingWorkspaceRescans(
  previous: ServerProvider | undefined,
  next: ServerProvider,
): string[] {
  if (!previous) return [];
  const agentChanged =
    previous.installed !== next.installed ||
    previous.version !== next.version ||
    previous.enabled !== next.enabled ||
    previous.status !== next.status ||
    previous.auth.status !== next.auth.status ||
    slashCommandNames(previous) !== slashCommandNames(next);
  if (!agentChanged) return [];
  return (previous.workspaceSnapshots ?? [])
    .filter((entry) => entry.slashCommandsPending === true)
    .map((entry) => entry.cwd);
}
