import { useAtomValue } from "@effect/atom-react";
import { useRoleOffers } from "~/zerops/usePlatformCapabilities";
import { shownHqMateDirectoryAtom, isListedMateEnvironment } from "@t3tools/client-runtime/data";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FolderPlusIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useClientSettings } from "~/hooks/useSettings";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useZeropsEnvironmentNames } from "~/zerops/useZeropsEnvironmentNames";
import { chiefQuestion } from "@t3tools/client-runtime/zerops/chief";
import { mateIdentityPose, zeropsMateAt } from "~/zerops/mateIdentities";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { useNowMs } from "~/zerops/useNowMs";
import { useZeropsMateDirectory } from "~/zerops/useZeropsMates";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateMark } from "../MateMark";
import { MateFace } from "../zerops/primitives";
import { mateFaceFor } from "~/zerops/agentActivity";
import { cn } from "~/lib/utils";
import {
  draftHeroHeadlineKind,
  draftHeroNoProject,
  draftHeroProjectName,
} from "./DraftHeroHeadline.logic";

interface DraftHeroHeadlineProps {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
  /**
   * The Mate asks its person how to work with them under it (`PersonaAsk`): its face waits on
   * them and the question gives way, unfolding again once answered.
   */
  readonly asking?: boolean;
}

export function DraftHeroHeadline({
  activeProjectRef,
  activeProjectTitle,
  asking = false,
}: DraftHeroHeadlineProps) {
  const allProjects = useProjects();
  const directory = useAtomValue(shownHqMateDirectoryAtom);
  const projects = useMemo(
    () =>
      allProjects.filter((project) => isListedMateEnvironment(directory, project.environmentId)),
    [allProjects, directory],
  );
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const handleNewThread = useNewThreadHandler();
  // One environment is one Zerops project: the picker names the project, not
  // the workspace folder, which is "www" in every container.
  const zeropsEnvironmentNames = useZeropsEnvironmentNames();
  // Where a Mate lives, the draft is the Mate's: its own face, and the
  // question is what it should do on its project.
  const mates = useZeropsMateDirectory();
  const whoLivesHere =
    activeProjectRef === null ? null : zeropsMateAt(mates, activeProjectRef.environmentId);
  const mate = whoLivesHere?.kind === "mate" ? whoLivesHere.mate : undefined;
  // A Chief's question is the organization's, never its own project's.
  const organization = useZeropsSessionOptional()?.activeOrganization?.name;
  const chiefAsks = mate?.chief === true ? chiefQuestion(mate.name, organization) : undefined;
  const nowMs = useNowMs();
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);
  const roleOffered = useRoleOffers();
  const noProject = draftHeroNoProject(roleOffered.newProject);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  // The caller has already named the project the way the header does (a
  // Zerops project's own name over the workspace folder); the logical
  // group's name is the fallback, not the other way round.
  const activeProjectDisplayName = activeProjectTitle ?? activeProjectGroup?.displayName ?? null;
  const projectName = draftHeroProjectName({ mateProject: mate?.project, activeProjectTitle });
  const hasResolvedProject = projectName !== null;
  const kind = draftHeroHeadlineKind({
    hasResolvedProject,
    inEnvironment: activeProjectRef !== null,
    canChooseProject: projectPickerEntries.length > 0,
  });
  const selectorLabel = mate?.project ?? activeProjectDisplayName;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            // The trigger's accessible name comes from its visible text (the
            // project title) so the hero sentence reads naturally: an
            // aria-label here would replace the title with an action phrase
            // mid-sentence and baffle screen-reader users.
            <MenuTrigger
              render={
                <InlineButton
                  className="pointer-events-auto min-w-0 max-w-64 align-baseline"
                  tone="picker"
                />
              }
            />
          }
        >
          <span className="min-w-0 truncate">{selectorLabel ?? "Choose a project"}</span>
        </TooltipTrigger>
        {selectorLabel ? <TooltipPopup side="top">{selectorLabel}</TooltipPopup> : null}
      </Tooltip>
      <MenuPopup align="center" className="max-h-80 overflow-y-auto">
        <MenuRadioGroup
          value={activeProjectKey}
          onValueChange={(value) => {
            const entry = projectEntryByKey.get(value as string);
            if (!entry || value === activeProjectKey) {
              return;
            }
            const project = entry.targetProject;
            // Changing the repo of a draft moves the typed content along:
            // the user started writing in the wrong project, not a new task.
            void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
              replace: true,
              carryComposerContent: true,
            });
          }}
        >
          {projectPickerEntries.map(({ group, targetProject }) => {
            const target = zeropsMateAt(mates, targetProject.environmentId);
            const label =
              target.kind === "mate"
                ? target.mate.name
                : (zeropsEnvironmentNames?.get(targetProject.environmentId) ?? group.displayName);
            return (
              <MenuRadioItem key={group.projectKey} value={group.projectKey} closeOnClick>
                <Tooltip>
                  <TooltipTrigger render={<span className="block min-w-0 truncate" />}>
                    {label}
                  </TooltipTrigger>
                  <TooltipPopup side="top">{label}</TooltipPopup>
                </Tooltip>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        {roleOffered.newProject ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={openAddProject}>
              <FolderPlusIcon />
              New project
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  ) : !noProject.offersNewProject ? (
    <span>{projectName ?? "No project yet"}</span>
  ) : (
    <span className="pointer-events-auto">
      <InlineButton tone="picker" onClick={openAddProject}>
        {projectName ?? "Add a project"}
      </InlineButton>
    </span>
  );

  // The composer hero is a sentence, so the heading's accessible name must be
  // a complete sentence too. The project picker is a control rendered inline
  // in the h1; without an explicit label its widget state bleeds into the
  // announced phrase.
  const projectSelectorText = shouldShowProjectMenu
    ? (selectorLabel ?? "Choose a project")
    : (projectName ?? (noProject.offersNewProject ? "Add a project" : "No project yet"));
  const headingLabel =
    kind === "reading"
      ? undefined
      : hasResolvedProject
        ? chiefAsks !== undefined
          ? chiefAsks
          : whoLivesHere?.kind === "unknown"
            ? projectSelectorText
            : mate === undefined
              ? `What should we build in ${projectSelectorText}?`
              : mate.project === undefined
                ? `What should ${mate.name} do?`
                : `What should ${mate.name} do on ${projectSelectorText}?`
        : canChooseProject
          ? `${projectSelectorText} to start`
          : noProject.words;

  return (
    <div className="flex flex-col items-center gap-5">
      {mate === undefined ? (
        <MateMark playful className="h-16 w-auto sm:h-[72px]" />
      ) : (
        // The mark's height, so the headline stays put when the Mate is known.
        <MateFace
          shape={mate.shape}
          size={64}
          state={
            asking ? "needs" : mateFaceFor(mate.connected, undefined, mateIdentityPose(mate, nowMs))
          }
          tint={mate.tint}
        />
      )}
      <div
        className={cn(
          "grid w-full transition-[grid-template-rows,opacity] duration-260 ease-in-out-strong motion-reduce:transition-none",
          asking ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
        )}
        inert={asking}
      >
        <div className={cn("min-h-0", asking && "overflow-hidden")}>
          <h1
            aria-label={headingLabel}
            // Its project still read: the line stands empty in its place, never "no project".
            aria-hidden={kind === "reading" ? true : undefined}
            className="mx-auto w-full max-w-5xl text-center font-normal text-title text-foreground tracking-tight sm:text-display"
          >
            {kind === "reading" ? (
              "\u00a0"
            ) : hasResolvedProject ? (
              chiefAsks !== undefined ? (
                chiefAsks
              ) : whoLivesHere?.kind === "unknown" ? (
                // Neither question while who lives here is not known: the
                // project alone, which both of them name.
                projectSelector
              ) : mate === undefined ? (
                <>What should we build in {projectSelector}?</>
              ) : mate.project === undefined ? (
                <>What should {mate.name} do?</>
              ) : (
                <>
                  What should {mate.name} do on {projectSelector}?
                </>
              )
            ) : canChooseProject ? (
              <>{projectSelector} to start</>
            ) : (
              <>{noProject.words}</>
            )}
          </h1>
        </div>
      </div>
    </div>
  );
}
