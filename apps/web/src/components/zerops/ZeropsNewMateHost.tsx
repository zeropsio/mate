/**
 * The New Mate dialog, over whatever the person is looking at (`newMate.ts`): a project's heading
 * in the left menu, its menu, the projects page — every "Add a Mate" asks here, and nothing
 * navigates to answer it (the owner, 2026-09-29, of a + that "leaves the conversation").
 *
 * Mounted once, above every view, so a creation outlives the dialog and whatever the person opens
 * next. Add closes the dialog and lands on the new Mate's own view at once (`/mate/new/$birthId`,
 * the owner, 2026-10-03: "why are these two screens separate?"): the steps this tab runs with the
 * person's session — its project, its container, closed off, registered — run on in the account's
 * creations (`newProjectBirth.ts`), and the view draws them under its copy's row, saying to keep
 * the tab open only while they run. Once the platform takes its project the view hands the route
 * to the Mate's own (`/mate/$projectId`), in place. A step that stops says why there, with *Try
 * again*.
 *
 * A project that takes no Mate now — its Mates have not written its recipe yet, or it cannot be
 * read — says why in the dialog instead (`newMateDoor`), and its one action leaves the dialog for
 * the recipe's change or the Mate writing it, or reads the recipe again.
 *
 * It also keeps a new Mate's conversation read while that view hands over to it, so the route
 * changing under the person paints the view's last frame, never a loading pane.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  buildZeropsGroupTree,
  canWriteRegistry,
  generateBotName,
  generateZeropsGroupId,
  newMateTint,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useThreadDetail, useThreadStatus } from "~/state/entities";
import { useAccountGitea, useAccountHoldsGitea } from "~/zerops/giteaProject";
import { useNewMate } from "~/zerops/newMate";
import { useZeropsProjectFlowOptional } from "~/zerops/projectFlowContext";
import {
  beginNewProjectBirth,
  newProjectView,
  progressNewProjectBirth,
  recipeManaged,
} from "~/zerops/newProjectBirth";
import { useEnvironmentCreation } from "~/zerops/useEnvironmentCreation";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useTakenBotNames, useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsAgentAuth } from "~/zerops/useZeropsFeeds";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { registryGroupSlug, useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { placedPressesIn, useMatePresses } from "~/zerops/matePress";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ZeropsEnvironmentCreationDialog } from "./ZeropsEnvironmentCreationDialog";
import {
  landedRecipeProposal,
  newMateDoor,
  newMateDoorMates,
  newMateRecipeChange,
  proposedEnvironmentName,
  recipeChangeView,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { environmentRoleLabel } from "./ZeropsGroupTree.logic";

export function ZeropsNewMateHost() {
  const asked = useNewMate((state) => state.asked);
  const handOver = useNewMate((state) => state.handOver);
  const { status } = useZeropsSession();
  // The creation lives here, above the dialog: it runs on after the dialog has closed.
  const create = useEnvironmentCreation();
  if (status !== "signed-in") return null;
  return (
    <>
      {asked === null ? null : (
        <NewMateDialog create={create} groupId={asked.groupId} key={asked.at} />
      )}
      {handOver === null ? null : (
        <KeepHandOverRead conversation={handOver} key={scopedThreadKey(handOver)} />
      )}
    </>
  );
}

/** How long a hand-over's conversation is kept read from here, across the route changing. */
const HAND_OVER_KEPT_MS = 3_000;

/**
 * A new Mate's conversation, and its agents' sign-in, kept read while its own view hands over to
 * it: the view let go of them as the route changed and the conversation picked them up in the same
 * moment, and a read let go of in between starts over — a loading pane where the view's last
 * frame should stand.
 */
function KeepHandOverRead({ conversation }: { readonly conversation: ScopedThreadRef }) {
  useThreadStatus(conversation);
  useThreadDetail(conversation);
  useZeropsAgentAuth(conversation.environmentId);
  const handingOver = useNewMate((state) => state.handingOver);
  useEffect(() => {
    const timer = setTimeout(() => handingOver(null), HAND_OVER_KEPT_MS);
    return () => clearTimeout(timer);
  }, [handingOver]);
  return null;
}

/** The dialog while it is asked for: who the Mate is, then — Add — where it lands. */
function NewMateDialog({
  groupId,
  create,
}: {
  readonly groupId: string;
  readonly create: ReturnType<typeof useEnvironmentCreation>;
}) {
  const { activeOrganization } = useZeropsSession();
  const { listing } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  // A Mate's name must be new on the account, not just in the project: it is what the left menu
  // calls the row, and two Adas is two of nothing.
  const taken = useTakenBotNames();
  const presses = useMatePresses();
  // The project as the menu draws it: a project being created counts, members listed or not.
  const entry = useMemo(
    () =>
      buildZeropsGroupTree(candidates, {
        order: "name",
        births: placedPressesIn(presses, activeOrganization?.id),
      }).groups.find((candidate) => candidate.group.groupId === groupId),
    [activeOrganization?.id, presses, candidates, groupId],
  );
  const accountGitea = useAccountGitea(activeOrganization?.id);
  const holdsGitea = useAccountHoldsGitea(activeOrganization?.id);
  const registry = useZeropsRegistry(activeOrganization?.id);
  // The account's flow: the group's org, known from its registry long before this opened, and
  // the group's changes, open and landed, as the forge last read them.
  const flow = useZeropsProjectFlowOptional();
  const groupFlow = flow?.flows.get(groupId);
  const slug = flow?.slugs.get(groupId) ?? registryGroupSlug(registry.registry, groupId);
  const recipe = useZeropsGroupRecipe({
    giteaOrigin: accountGitea?.state.url,
    slug,
    tier: "mate",
    enabled: true,
    // No org is not yet no recipe while the account's Gitea, or the registry naming the org, is
    // still being read.
    pending: (holdsGitea && accountGitea === undefined) || (slug === undefined && registry.loading),
    // A proposal of the recipe landing while the dialog is open puts it on `main`: read again.
    revision:
      groupFlow?.changesKnown === true
        ? String(landedRecipeProposal(groupFlow.merged) ?? "")
        : undefined,
  });
  // Who sets the project up and writes its recipe: its Mates, listed and coming.
  const mates = useMemo(
    () =>
      entry === undefined
        ? []
        : newMateDoorMates({ environments: entry.environments, pending: entry.group.pending }),
    [entry],
  );
  const openMate = useOpenMate();
  // A proposal only: the dialog refuses it until every Mate's name is read, and names the clash
  // if one turns up.
  const [defaultBotName] = useState(() =>
    generateBotName(taken.names, (bytes) => crypto.getRandomValues(bytes)),
  );
  const dismiss = useNewMate((state) => state.dismiss);
  const created = useNewMate((state) => state.created);
  const settled = useNewMate((state) => state.settled);
  const navigate = useNavigate();

  if (entry === undefined) return null;
  const { group, environments } = entry;
  const door = newMateDoor({
    groupName: group.name,
    recipe: recipe.state,
    mates,
    change: newMateRecipeChange({
      flow: groupFlow,
      mateName: (projectId) =>
        mates.find((mate) => mate.projectId === projectId)?.name ?? flow?.mateNames.get(projectId),
    }),
    rereading: recipe.rereading,
  });
  const roleLabel = environmentRoleLabel("dev")?.toLowerCase() ?? "dev";
  const proposeName = (botName: string) =>
    proposedEnvironmentName({
      groupName: group.name,
      roleLabel,
      botName,
      taken: environments.map(({ item }) => item.project.name),
    });

  return (
    <ZeropsEnvironmentCreationDialog
      closed={door.kind === "closed" ? door : undefined}
      defaultBotName={defaultBotName}
      defaultName={proposeName(defaultBotName)}
      defaultTintFor={(name) => newMateTint(candidates, name)}
      defaultWithAgent
      groupName={group.name}
      onCancel={dismiss}
      onCreate={(choice) => {
        if (activeOrganization === null) return;
        const name = choice.botName ?? choice.name;
        const face = choice.face ?? { tint: "slate", shape: "squircle" };
        // Its own id, its view's: a random one, as a New project's group's.
        const id = generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes));
        // Held from the press, its steps run on in the account's creations: the dialog gives way
        // to the Mate's view at once.
        beginNewProjectBirth({
          id,
          ask: {
            organizationId: activeOrganization.id,
            groupId: group.groupId,
            name: group.name,
            botName: name,
            face,
            locationId: null,
            agents: [],
            adds: {
              displayName: choice.name,
              // As the press decides it: an owner or an admin writes a Mate's registration.
              registers: accountGitea !== undefined && canWriteRegistry(activeOrganization),
              // Named from the press, so its copy's line stands before the plan is heard.
              managed:
                choice.recipe.kind === "tier" ? recipeManaged(choice.recipe.yaml) : undefined,
            },
          },
          gitea: accountGitea === undefined ? undefined : { projectId: accountGitea.projectId },
          now: Date.now(),
          ports: {
            ensureGitea: () => Promise.reject(new Error("An added Mate brings no Git hosting.")),
            registerGroup: () => Promise.reject(new Error("An added Mate's project stands.")),
            // Taken once the platform takes its project; the press runs on after it, and a stop
            // after that is its press's to say (`matePress.ts`).
            createProject: () =>
              new Promise((resolve, reject) => {
                let accepted: string | undefined;
                void create({
                  group,
                  environments,
                  role: "dev",
                  choice,
                  onAccepted: (projectId) => {
                    accepted = projectId;
                    resolve({ project: { id: projectId } });
                  },
                  onProgress: (progress) => progressNewProjectBirth(id, progress),
                }).then((run) => {
                  const error =
                    run.kind === "refused"
                      ? (run.reason ?? "It could not be added.")
                      : run.outcome.ok
                        ? undefined
                        : run.outcome.error;
                  if (accepted === undefined) {
                    reject(new Error(error ?? "It could not be added."));
                    return;
                  }
                  if (error !== undefined) settled(accepted, error);
                });
              }),
            accepted: (projectId) => {
              created({
                projectId,
                groupId: group.groupId,
                groupName: group.name,
                botName: name,
                face,
              });
            },
          },
        });
        dismiss();
        void navigate(newProjectView(id));
      }}
      onDoorAction={(action) => {
        if (action.kind === "retry") {
          recipe.reread();
          return;
        }
        // The dialog gives way to where the recipe is: its change, or the Mate writing it.
        dismiss();
        if (action.kind === "change") void navigate(recipeChangeView(group.groupId, action.number));
        else openMate({ projectId: action.projectId });
      }}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      open
      proposeAnotherName={(current) =>
        generateBotName([...taken.names, current], (bytes) => crypto.getRandomValues(bytes))
      }
      proposeName={proposeName}
      role="dev"
      takenBotNames={taken}
      tier={recipe.tier}
      tierLoading={recipe.loading}
      tierServices={recipe.services}
    />
  );
}
