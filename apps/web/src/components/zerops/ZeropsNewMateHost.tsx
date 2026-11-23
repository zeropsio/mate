/**
 * The New Mate dialog, over whatever the person is looking at (`newMate.ts`): a project's heading
 * in the left menu, its menu, the projects page — every "Add a Mate" asks here, and nothing
 * navigates to answer it (the owner, 2026-09-29, of a + that "leaves the conversation").
 *
 * Mounted once, above every view, so a creation outlives the dialog and whatever the person opens
 * next. Add closes the dialog and lands on the new Mate's own view at once (`/mate/new/$birthId`,
 * the owner, 2026-10-03: "why are these two screens separate?"): Add is one Create at HQ, which
 * runs the Mate's birth — its project, its key, its one import — whether this tab stays or not
 * (`useEnvironmentCreation`), and the view follows that birth (`creations.ts`). Once its project
 * stands the view hands the route to the Mate's own (`/mate/$projectId`), in place. A Create HQ
 * refuses says why there, with *Try again*.
 *
 * A project that takes no Mate now — its Mates have not written its recipe yet, or it cannot be
 * read — says why in the dialog instead (`newMateDoor`), and its one action leaves the dialog for the recipe's change or the Mate
 * writing it, or reads the recipe again.
 *
 * It also keeps a new Mate's conversation read while that view hands over to it, so the route
 * changing under the person paints the view's last frame, never a loading pane.
 */
import { useSharedBirths } from "~/zerops/sharedBirths";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { generateBotName, newMateTint } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { usePreloadMateViews } from "~/zerops/usePreloadMateViews";
import { useContext, useMemo, useState } from "react";
import { AccountDataContext } from "../../zerops/accountData";

import { useThreadDetail, useThreadStatus } from "~/state/entities";
import { randomUUID } from "~/lib/utils";
import { configuredHq } from "~/zerops/accountHq";
import { beginCreation, refuseAddHere } from "~/zerops/creations";
import { useMateHandOver, useNewMateDialog, type NewMateAgain } from "~/zerops/newMate";
import { useAppsChanges, useMateNames } from "~/zerops/projectFlows";
import {
  creationRunId,
  newProjectView,
  recipeManaged,
  recipeRuntimes,
} from "~/zerops/newProjectBirth";
import {
  useEnvironmentCreation,
  type EnvironmentCreationChoice,
} from "~/zerops/useEnvironmentCreation";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useAwaitsYourSignIn } from "~/zerops/useSignInWaits";
import { useTakenBotNames, useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsAgentAuth } from "~/zerops/useZeropsFeeds";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { useProjectsInventory } from "~/zerops/projectsInventory";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { useAppIntake, useHoldAutomatedKey, useOrgAiKeys } from "~/zerops/useAutomationSettings";
import { automatedKeyState, type AutomatedKeyState } from "~/zerops/automatedMate.logic";
import { useAppTaskSource, useOrgTaskSource } from "~/zerops/useTaskSourceSettings";

import { Dialog, DialogPopup } from "../ui/dialog";
import { AddAutomatedMatesForm, type AddAutomatedMatesFormProps } from "./AddAutomatedMatesForm";
import { automatedSourcesWords } from "./addAutomatedMates.logic";
import { ProjectAccessDraft, useDraftPeople } from "./projects/ProjectPeople";
import { ZeropsCreditForecast } from "./ZeropsCreditForecast";
import { ZeropsEnvironmentCreationDialog } from "./ZeropsEnvironmentCreationDialog";
import { creationRecipe, recipeChangeView } from "./ZeropsEnvironmentCreationDialog.logic";
import {
  newMateDoor,
  newMateDoorMates,
  newMateRecipeChange,
  type NewMateDoorAction,
  type NewMateDoorClosed,
} from "@t3tools/client-runtime/zerops/newMateDoor";
import { useAddMateOffer, useOrgOffers } from "../../zerops/useHqOffers";
import { hqOfferWords } from "@t3tools/client-runtime/zerops/hq";

const BY_NAME = { order: "name" } as const;

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
  // The project as the menu's tree draws it (`useProjectsInventory`): the Mates HQ is making count,
  // and one HQ holds with nothing in it is the one its first Mate is added to.
  const { groups } = useProjectsInventory(candidates, BY_NAME);
  const entry = useMemo(() => {
    const found = groups.find((candidate) => candidate.group.groupId === groupId);
    // Its members the account lists: an environment HQ records with no listed project has no Mate.
    return found === undefined
      ? undefined
      : {
          group: found.group,
          environments: found.environments.flatMap(({ item }) =>
            item === undefined ? [] : [{ item }],
          ),
        };
  }, [groupId, groups]);
  // The application's changes, open and landed, held while the door is drawn.
  const { changes } = useAppsChanges(useMemo(() => [groupId], [groupId]));
  const appChanges = changes.get(groupId);
  const mateNames = useMateNames();
  const recipe = useZeropsGroupRecipe({
    appId: groupId,
    tier: "mate",
    enabled: true,
  });
  // Who sets the project up and writes its recipe: its Mates, listed and coming — one waiting for
  // the viewer's sign-in says so.
  const awaitsYourSignIn = useAwaitsYourSignIn(candidates);
  const births = useSharedBirths();
  const mates = useMemo(
    () =>
      entry === undefined
        ? []
        : newMateDoorMates({
            environments: entry.environments,
            pending: entry.group.pending,
            awaitsYourSignIn,
            birthOn: (projectId) => births.some((birth) => birth.projectId === projectId),
          }),
    [awaitsYourSignIn, births, entry],
  );
  const openMate = useOpenMate();
  // A proposal only: the dialog refuses it until every Mate's name is read, and names the clash
  // if one turns up.
  const [defaultBotName] = useState(
    () => again?.botName ?? generateBotName(taken.names, (bytes) => crypto.getRandomValues(bytes)),
  );
  const dismiss = useNewMateDialog((state) => state.dismiss);
  const navigate = useNavigate();
  usePreloadMateViews();

  const addOffer = useAddMateOffer()(groupId);
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
      ? {
          kind: "closed",
          reason: hqOfferWords(addOffer) ?? "Checking your access…",
          action: undefined,
        }
      : door.kind === "closed"
        ? door
        : undefined;
  const forecast =
    activeOrganization === null ? undefined : (
      <ZeropsCreditForecast organizationId={activeOrganization.id} />
    );

  /**
   * Starts one Mate's Add: one Create at HQ, whose birth HQ runs, so the dialog gives way at once
   * and the tab may close. Each *Try again* sends the same Create, under the same birth id, as its
   * next press (`creationRunId`). Its creation's id, or `null` where nothing started.
   */
  const begin = (choice: EnvironmentCreationChoice): string | null => {
    if (activeOrganization === null || addOffer.kind !== "allowed") return null;
    const { name } = choice;
    const face = choice.face ?? { tint: "slate", shape: "squircle" };
    const tier = choice.recipe.kind === "tier" ? choice.recipe.yaml : undefined;
    // Its own id, its view's: a random one, as a New project's group's.
    const id = randomUUID();
    const organizationId = activeOrganization.id;
    beginCreation({
      ask: {
        organizationId,
        creator: activeOrganization.membershipId,
        creatorRole: activeOrganization.roleCode,
        birthId: id,
        name: group.name,
        botName: name,
        face,
        locationId: null,
        agents: [],
        adds: {
          appId: group.groupId,
          // Named from the press, so its copy's and its workspace's lines stand before the
          // plan is heard.
          managed: tier === undefined ? undefined : recipeManaged(tier),
          runtimes: tier === undefined ? undefined : recipeRuntimes(tier),
          ...(choice.automated === true ? { automated: true as const } : {}),
        },
      },
      hq: configuredHq(),
      now: Date.now(),
      // HQ's answer to the Create is its step's (`creationSteps`); what stopped it here before
      // anything was sent — the plan, the group's agents — is this tab's to say.
      run: (held) =>
        void create({
          group,
          environments,
          role: "dev",
          choice,
          creationId: creationRunId(held),
          birthId: held.ask.birthId,
        }).then(
          (run) => {
            if (run.kind === "refused" && run.reason !== null) refuseAddHere(id, run.reason);
          },
          (cause: unknown) => refuseAddHere(id, zeropsErrorMessage(cause)),
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
  const setsKey = useOrgOffers()("add_automated_mate").kind === "allowed";
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
      <DialogPopup className="max-w-lg" placement="center">
        <AddAutomatedMatesForm
          {...form}
          admin={setsKey}
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
