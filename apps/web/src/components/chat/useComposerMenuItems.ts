import type { Crewmate, ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import type {
  ComposerPathSearchState,
  ComposerPathSearchTarget,
} from "@t3tools/client-runtime/state/threads";
import type { DataMentionEntry } from "@t3tools/client-runtime/zerops/dataConsole";
import { providerCommandOffered } from "@t3tools/client-runtime/zerops/composer/commandOffers";
import {
  formatProviderSkillDisplayName,
  getProviderSlashCommandsForSlashMenu,
  getProviderSkillsForSlashMenu,
} from "@t3tools/client-runtime/providerSkills";
import { useMemo } from "react";

import type { ComposerTrigger } from "../../composer-logic";
import { basenameOfPath } from "../../pierre-icons";
import { searchProviderSkills } from "../../providerSkillSearch";
import { mateMenuMatches, type MentionableMate } from "../../zerops/mateMentions";
import { crewmateMenuItems } from "../zerops/crew/CrewTellComposer.logic";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import {
  searchSlashCommandItems,
  slashCommandItemsForPromptPosition,
  withoutShadowedProviderCommands,
} from "./composerSlashCommandSearch";

/** The items the composer's menu offers for the trigger at the caret (`ChatComposer`): commands, skills, mentions, files and data. */
export function useComposerMenuItems({
  composerTrigger,
  mentionCrewmates,
  mentionMates,
  workspaceEntries,
  dataMentions,
  mcpCommandOffered,
  boardCommandOffered,
  planModeUiEnabled,
  selectedProviderSkills,
  settings,
  selectedProviderSlashCommands,
  selectedProvider,
  compactSlashCommandAvailable,
  selectedProviderStatus,
}: {
  composerTrigger: ComposerTrigger | null;
  mentionCrewmates: ReadonlyArray<Crewmate> | undefined;
  mentionMates: ReadonlyArray<MentionableMate> | undefined;
  workspaceEntries: ComposerPathSearchState & { readonly searchedTarget: ComposerPathSearchTarget };
  dataMentions: ReadonlyArray<DataMentionEntry>;
  mcpCommandOffered: boolean;
  /** `/board`: the conversation's Mate may put work on its application's Board. */
  boardCommandOffered: boolean;
  planModeUiEnabled: boolean;
  selectedProviderSkills: ServerProvider["skills"];
  settings: UnifiedSettings;
  selectedProviderSlashCommands: ServerProvider["slashCommands"];
  selectedProvider: ProviderDriverKind;
  compactSlashCommandAvailable: boolean;
  selectedProviderStatus: ServerProvider | null;
}) {
  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path" || composerTrigger.kind === "crewmate") {
      const crewmateItems =
        composerTrigger.kind === "crewmate" && mentionCrewmates !== undefined
          ? crewmateMenuItems(mentionCrewmates, composerTrigger.query)
          : [];
      const mateItems =
        mentionMates === undefined
          ? []
          : mateMenuMatches(mentionMates, composerTrigger.query).map((mate) => ({
              id: `mate:${mate.projectId}`,
              type: "mate" as const,
              projectId: mate.projectId,
              name: mate.name,
              tint: mate.tint,
              shape: mate.shape,
              label: mate.name,
              description: mate.project ?? "",
            }));
      const fileItems = workspaceEntries.entries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path" as const,
        path: entry.path,
        pathKind: entry.kind,
        searchTarget: workspaceEntries.searchedTarget,
        label: basenameOfPath(entry.path),
        description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
      }));
      const query = composerTrigger.query.trim().toLowerCase();
      const dataItems = dataMentions.map((entry) => ({
        id: `data:${entry.token}`,
        type: "data" as const,
        entry,
        label: entry.token,
        description:
          entry.kind === "service"
            ? `Data service · ${entry.serviceType}`
            : `Table in ${entry.service}`,
      }));
      // A data mention only outranks the file results when the user is
      // plainly typing its name; otherwise files stay first, as before.
      const named = (item: (typeof dataItems)[number]) =>
        query.length > 0 &&
        [item.entry.token, ...item.entry.aliases].some((candidate) =>
          candidate.toLowerCase().startsWith(query),
        );
      return [
        ...crewmateItems,
        ...mateItems,
        ...dataItems.filter((item) => named(item)),
        ...fileItems,
        ...dataItems.filter((item) => !named(item)),
      ];
    }
    if (composerTrigger.kind === "slash-command") {
      const builtInSlashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: "/model",
          description: "Switch response model for this thread",
        },
        ...(mcpCommandOffered
          ? ([
              {
                id: "slash:mcp",
                type: "slash-command",
                command: "mcp",
                label: "/mcp",
                description: "See and add the MCP servers your agents can call",
              },
            ] as const)
          : []),
        ...(boardCommandOffered
          ? ([
              {
                id: "slash:board",
                type: "slash-command",
                command: "board",
                label: "/board",
                description: "Put this on the Board for whoever takes it, instead of doing it now",
              },
            ] as const)
          : []),
        ...(planModeUiEnabled
          ? ([
              {
                id: "slash:plan",
                type: "slash-command",
                command: "plan",
                label: "/plan",
                description: "Switch this thread into plan mode",
              },
              {
                id: "slash:default",
                type: "slash-command",
                command: "default",
                label: "/default",
                description: "Switch this thread back to normal build mode",
              },
            ] as const)
          : []),
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const slashMenuSkills = getProviderSkillsForSlashMenu(
        selectedProviderSkills,
        settings.showSkillsInSlashMenu,
      );
      const providerSlashCommandItems = getProviderSlashCommandsForSlashMenu(
        selectedProviderSlashCommands,
        slashMenuSkills,
      ).map((command) => ({
        id: `provider-slash-command:${selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        provider: selectedProvider,
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }));
      const query = composerTrigger.query.trim().toLowerCase();
      const skillItems = slashMenuSkills.map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: `/skill:${skill.name}`,
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : ""),
      }));
      const visibleProviderSlashCommandItems = providerSlashCommandItems.filter((item) =>
        providerCommandOffered(item.command.name, compactSlashCommandAvailable),
      );
      const slashCommandItems = slashCommandItemsForPromptPosition(
        withoutShadowedProviderCommands([
          ...builtInSlashCommandItems,
          ...visibleProviderSlashCommandItems,
          ...skillItems,
        ]),
        composerTrigger.rangeStart === 0,
      );
      return searchSlashCommandItems(slashCommandItems, query);
    }
    if (composerTrigger.kind === "skill") {
      return searchProviderSkills(selectedProviderSkills, composerTrigger.query).map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
      }));
    }
    return [];
  }, [
    boardCommandOffered,
    compactSlashCommandAvailable,
    composerTrigger,
    dataMentions,
    mcpCommandOffered,
    mentionCrewmates,
    mentionMates,
    planModeUiEnabled,
    selectedProvider,
    selectedProviderSkills,
    selectedProviderSlashCommands,
    selectedProviderStatus,
    settings.showSkillsInSlashMenu,
    workspaceEntries.entries,
    workspaceEntries.searchedTarget,
  ]);
  return composerMenuItems;
}
