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
 * read — says why in the dialog instead (`newMateDoor`), and its one action leaves the dialog for the recipe's change or the Mate
 * writing it, or reads the recipe again.
 *
 * It also keeps a new Mate's conversation read while that view hands over to it, so the route
 * changing under the person paints the view's last frame, never a loading pane.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  buildZeropsGroupTree,
  generateBotName,
  generateZeropsGroupId,
  newMateTint,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useState } from "react";

import { useThreadDetail, useThreadStatus } from "~/state/entities";
import { officialHq, useAccountHq } from "~/zerops/accountHq";
import { hqNavigationAtom } from "~/state/zerops";
import { useNewMate, type NewMateAgain } from "~/zerops/newMate";
import { useAppsChanges, useMateNames } from "~/zerops/projectFlows";
import {
  addCreateProject,
  beginNewProjectBirth,
  newProjectView,
  progressNewProjectBirth,
  recipeManaged,
  recipeRuntimes,
} from "~/zerops/newProjectBirth";
import { useEnvironmentCreation } from "~/zerops/useEnvironmentCreation";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useTakenBotNames, useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsAgentAuth } from "~/zerops/useZeropsFeeds";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { placedPressesIn, useMatePresses } from "~/zerops/matePress";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ZeropsEnvironmentCreationDialog } from "./ZeropsEnvironmentCreationDialog";
import {
  creationRecipe,
  newMateDoor,
  newMateDoorMates,
  newMateRecipeChange,
  recipeChangeView,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { emptyApplications } from "./projects/emptyApps.logic";

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
        <NewMateDialog again={asked.again} create={create} groupId={asked.groupId} key={asked.at} />
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
  again,
}: {
  readonly groupId: string;
  readonly create: ReturnType<typeof useEnvironmentCreation>;
  /** An Add started over: its name, its environment's and its tint, there to change. */
  readonly again?: NewMateAgain | undefined;
}) {
  const { activeOrganization } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);
  const { listing } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  // A Mate's name must be new on the account, not just in the project: it is what the left menu
  // calls the row, and two Adas is two of nothing.
  const taken = useTakenBotNames();
  const presses = useMatePresses();
  const hqStructure = useAtomValue(hqNavigationAtom);
  // The project as the menu draws it: a project being created counts, members listed or not, and
  // one HQ holds with nothing in it is the one its first Mate is added to.
  const entry = useMemo(
    () =>
      buildZeropsGroupTree(candidates, {
        order: "name",
        births: placedPressesIn(presses, activeOrganization?.id),
        apps: emptyApplications(hqStructure, activeOrganization?.id),
      }).groups.find((candidate) => candidate.group.groupId === groupId),
    [activeOrganization?.id, presses, candidates, groupId, hqStructure],
  );
  // The application's changes, open and landed, held while the door is drawn.
  const { changes } = useAppsChanges(useMemo(() => [groupId], [groupId]));
  const appChanges = changes.get(groupId);
  const mateNames = useMateNames();
  const recipe = useZeropsGroupRecipe({
    appId: groupId,
    tier: "mate",
    enabled: true,
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
  const [defaultBotName] = useState(
    () => again?.botName ?? generateBotName(taken.names, (bytes) => crypto.getRandomValues(bytes)),
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
      flow: appChanges === undefined ? undefined : { ...appChanges, changesKnown: true },
      mateName: (projectId) =>
        mates.find((mate) => mate.projectId === projectId)?.name ?? mateNames.get(projectId),
    }),
    rereading: recipe.rereading,
  });
  return (
    <ZeropsEnvironmentCreationDialog
      closed={door.kind === "closed" ? door : undefined}
      // The Mate's own name, its project's built from it: started over, the name it was asked with.
      defaultName={defaultBotName}
      defaultTintFor={(name) =>
        name === again?.botName ? again.tint : newMateTint(candidates, name)
      }
      defaultShapeFor={(name) => (name === again?.botName ? again.shape : undefined)}
      defaultWithAgent
      groupName={group.name}
      // Add lands on the new Mate's page, which takes the focus.
      landsElsewhere
      onCancel={dismiss}
      onCreate={(choice) => {
        if (activeOrganization === null) return;
        const { name } = choice;
        const face = choice.face ?? { tint: "slate", shape: "squircle" };
        const tier = choice.recipe.kind === "tier" ? choice.recipe.yaml : undefined;
        // Its own id, its view's: a random one, as a New project's group's.
        const id = generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes));
        // Held from the press, its steps run on in the account's creations: the dialog gives way
        // to the Mate's view at once.
        beginNewProjectBirth({
          ask: {
            organizationId: activeOrganization.id,
            birthId: id,
            name: group.name,
            botName: name,
            face,
            locationId: null,
            agents: [],
            adds: {
              appId: group.groupId,
              // As the press decides it: an owner or an admin writes a Mate's registration.
              registers: true,
              // Named from the press, so its copy's and its workspace's lines stand before the
              // plan is heard.
              managed: tier === undefined ? undefined : recipeManaged(tier),
              runtimes: tier === undefined ? undefined : recipeRuntimes(tier),
            },
          },
          hq: officialHq(accountHq),
          now: Date.now(),
          ports: {
            recordBirth: () => Promise.reject(new Error("The Add press owns its birth intent.")),
            registerGroup: () => Promise.reject(new Error("An added Mate's project stands.")),
            // Taken once the platform takes its project; the press runs on after it, and a stop
            // after that is its press's to say (`matePress.ts`).
            createProject: () =>
              addCreateProject({
                run: (onAccepted) =>
                  create({
                    group,
                    environments,
                    role: "dev",
                    choice,
                    onAccepted,
                    onProgress: (progress) => progressNewProjectBirth(id, progress),
                  }),
                settled,
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
      role="dev"
      takenBotNames={taken}
      tier={recipe.tier}
      recipe={creationRecipe(recipe)}
      tierServices={recipe.services}
    />
  );
}
