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
import { usePreloadMateViews } from "~/zerops/usePreloadMateViews";
import { useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useMemo, useState } from "react";
import { AccountDataContext } from "../../zerops/accountData";

import { useThreadDetail, useThreadStatus } from "~/state/entities";
import { configuredHq } from "~/zerops/accountHq";
import { hqNavigationAtom } from "~/state/zerops";
import { useAccountOperations } from "~/zerops/accountOperations";
import { beginCreation, refuseAddHere, runOnce } from "~/zerops/creations";
import { useMateHandOver, useNewMateDialog, type NewMateAgain } from "~/zerops/newMate";
import { useAppsChanges, useMateNames } from "~/zerops/projectFlows";
import { newProjectView, recipeManaged, recipeRuntimes, runAdd } from "~/zerops/newProjectBirth";
import { useEnvironmentCreation } from "~/zerops/useEnvironmentCreation";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useTakenBotNames, useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsAgentAuth } from "~/zerops/useZeropsFeeds";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { placedPressesIn, useMatePresses } from "~/zerops/matePress";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { useAppIntake, useHoldAutomatedKey, useOrgAiKeys } from "~/zerops/useAutomationSettings";
import { automatedKeyState, type AutomatedKeyState } from "~/zerops/automatedMate.logic";
import { useAppTaskSource, useOrgTaskSource } from "~/zerops/useTaskSourceSettings";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";

import { Dialog, DialogPopup } from "../ui/dialog";
import { AddAutomatedMatesForm, type AddAutomatedMatesFormProps } from "./AddAutomatedMatesForm";
import { automatedSourcesWords } from "./addAutomatedMates.logic";
import { ProjectAccessDraft, useDraftPeople } from "./projects/ProjectPeople";
import { ZeropsCreditForecast } from "./ZeropsCreditForecast";
import {
  ZeropsEnvironmentCreationDialog,
  type EnvironmentCreationChoice,
} from "./ZeropsEnvironmentCreationDialog";
import {
  creationRecipe,
  newMateDoor,
  newMateDoorMates,
  newMateRecipeChange,
  recipeChangeView,
  type NewMateDoorAction,
  type NewMateDoorClosed,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { useAddMateOffer, useHqOffers } from "../../zerops/useHqOffers";
import { emptyApplications } from "./projects/emptyApps.logic";

export function ZeropsNewMateHost() {
  const asked = useNewMateDialog((state) => state.asked);
  const handOver = useMateHandOver((state) => state.handOver);
  const { status } = useZeropsSession();
  // The creation lives here, above the dialog: it runs on after the dialog has closed.
  const create = useEnvironmentCreation();
  const accountData = useContext(AccountDataContext);
  if (status !== "signed-in") return null;
  return (
    <>
      {/* The account's data reads the listed Mates; a host mounted without them holds nothing. */}
      {accountData === null ? null : <HoldAutomatedKey />}
      {asked === null ? null : (
        <NewMateDialog again={asked.again} create={create} groupId={asked.groupId} key={asked.at} />
      )}
      {handOver === null ? null : (
        <KeepHandOverRead conversation={handOver} key={scopedThreadKey(handOver)} />
      )}
    </>
  );
}

/** The organization's key for automated Mates, read once while signed in (`useAutomatedKey`). */
function HoldAutomatedKey() {
  useHoldAutomatedKey();
  return null;
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
  const handingOver = useMateHandOver((state) => state.handingOver);
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
  const dismiss = useNewMateDialog((state) => state.dismiss);
  const operations = useAccountOperations();
  const navigate = useNavigate();
  usePreloadMateViews();

  const addOffer = useAddMateOffer()(groupId);
  const { words } = useHqOffers();
  // Whether the organization holds the API key automated Mates run on: said in their dialog. An
  // HQ that keeps no organization keys can't make them. Read from the app's root once signed in,
  // it is known before the dialog's first frame.
  const automatedKey = automatedKeyState(useOrgAiKeys(again?.automated === true).read.keys);
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
  const closed: NewMateDoorClosed | undefined =
    addOffer.kind !== "allowed"
      ? { kind: "closed", reason: words(addOffer) ?? "Checking your access…", action: undefined }
      : door.kind === "closed"
        ? door
        : undefined;
  const forecast =
    activeOrganization === null ? undefined : (
      <ZeropsCreditForecast organizationId={activeOrganization.id} />
    );

  /**
   * Starts one Mate's Add, held from the press: its steps run on in the account's operations, so
   * the dialog gives way at once. A stop once the platform took its project is its press's to say
   * (`matePress.ts`). Its creation's id, or `null` where nothing started.
   */
  const begin = (choice: EnvironmentCreationChoice): string | null => {
    if (activeOrganization === null || addOffer.kind !== "allowed") return null;
    const { name } = choice;
    const face = choice.face ?? { tint: "slate", shape: "squircle" };
    const tier = choice.recipe.kind === "tier" ? choice.recipe.yaml : undefined;
    // Its own id, its view's: a random one, as a New project's group's.
    const id = generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes));
    const organizationId = activeOrganization.id;
    beginCreation({
      ask: {
        organizationId,
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
          ...(choice.automated === true ? { automated: true as const } : {}),
        },
      },
      hq: configuredHq(),
      now: Date.now(),
      run: (held) =>
        void runOnce(id, () =>
          runAdd(
            held,
            (creationId) => operations.readCreation(organizationId, creationId),
            (creationId) =>
              create({
                group,
                environments,
                role: "dev",
                choice,
                creationId,
                pressedAt: held.startedAt,
              }),
            (reason) => refuseAddHere(id, reason),
          ),
        ),
    });
    return id;
  };
  const onDoorAction = (action: NewMateDoorAction) => {
    if (action.kind === "retry") {
      recipe.reread();
      return;
    }
    // The dialog gives way to where the recipe is: its change, or the Mate writing it.
    dismiss();
    if (action.kind === "change") void navigate(recipeChangeView(group.groupId, action.number));
    else openMate({ projectId: action.projectId });
  };

  // Automated Mates have their own dialog: how many, no people list, what they do. A project
  // that takes no Mate now says why as New Mate does.
  if (again?.automated === true && closed === undefined)
    return (
      <AutomatedMatesDialog
        again={again}
        forecast={forecast}
        groupId={group.groupId}
        groupName={group.name}
        keyState={automatedKey}
        onCancel={dismiss}
        onCreate={(choice) => {
          // Each comes up in the menu and the project's pool; the person stays where they are.
          for (const mate of choice.mates)
            begin({
              name: mate.name,
              face: mate.face,
              withAgent: true,
              recipe: choice.recipe,
              userRoles: choice.userRoles,
              automated: true,
            });
          dismiss();
        }}
        onOpenKeySettings={() => {
          // The dialog gives way to where the key is set.
          dismiss();
          void navigate({ to: "/settings/automation" });
        }}
        propose={(names) =>
          generateBotName([...taken.names, ...names], (bytes) => crypto.getRandomValues(bytes))
        }
        recipe={recipe}
        takenBotNames={taken}
        tintFor={(name) =>
          again.botName !== undefined && name === again.botName
            ? again.tint
            : newMateTint(candidates, name)
        }
      />
    );
  return (
    <ZeropsEnvironmentCreationDialog
      access={(onChange) => (
        <ProjectAccessDraft
          groupId={group.groupId}
          kind="mate"
          label="Who can work with this Mate"
          onChange={onChange}
        />
      )}
      {...(forecast === undefined ? {} : { forecast })}
      closed={closed}
      // The Mate's own name, its project's built from it: started over, the name it was asked with.
      defaultName={defaultBotName}
      defaultTintFor={(name) =>
        again?.botName !== undefined && name === again.botName
          ? again.tint
          : newMateTint(candidates, name)
      }
      defaultShapeFor={(name) =>
        again?.botName !== undefined && name === again.botName ? again.shape : undefined
      }
      defaultWithAgent
      groupName={group.name}
      // Add lands on the new Mate's page, which takes the focus.
      landsElsewhere
      onCancel={dismiss}
      onCreate={(choice) => {
        const id = begin(choice);
        if (id === null) return;
        dismiss();
        void navigate(newProjectView(id));
      }}
      onDoorAction={onDoorAction}
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

/**
 * *Add automated Mates*, over whatever the person looks at: the project's sources, the limits on a
 * task and the project's people are read while it is open (`AddAutomatedMatesForm`).
 */
function AutomatedMatesDialog({
  groupId,
  again,
  recipe,
  keyState,
  ...form
}: Omit<
  AddAutomatedMatesFormProps,
  "firstName" | "tier" | "tierLoading" | "sources" | "keyState" | "admin" | "limits" | "people"
> & {
  readonly groupId: string;
  readonly again: NewMateAgain;
  readonly recipe: ReturnType<typeof useZeropsGroupRecipe>;
  readonly keyState: AutomatedKeyState;
}) {
  const { activeOrganization } = useZeropsSession();
  const people = useDraftPeople(groupId, "mate");
  const intake = useAppIntake(groupId).read.intake;
  const slack = useAppTaskSource("hqAppSlack", groupId).read.setting;
  const discord = useAppTaskSource("hqAppDiscord", groupId).read.setting;
  const webhooks = useAppTaskSource("hqAppWebhooks", groupId).read.setting;
  const schedules = useAppTaskSource("hqAppSchedules", groupId).read.setting;
  const limits = useOrgTaskSource("hqTaskLimits").read.setting;
  const known = <T,>(setting: { readonly state: string; readonly held?: T }) =>
    setting.state === "known" ? setting.held : undefined;
  const sources = automatedSourcesWords({ intake, slack, discord, webhooks, schedules });
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) form.onCancel();
      }}
      open
    >
      <DialogPopup className="max-w-lg">
        <AddAutomatedMatesForm
          {...form}
          admin={roleAtLeast(activeOrganization?.roleCode, "ADMIN")}
          firstName={again.botName}
          keyState={keyState}
          limits={known(limits)}
          people={people}
          sources={sources}
          tier={recipe.tier}
          tierLoading={creationRecipe(recipe) === "reading"}
        />
      </DialogPopup>
    </Dialog>
  );
}
