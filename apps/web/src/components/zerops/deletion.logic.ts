/**
 * Deleting a Mate and its project, decided once (`deletionOffer`) and said in words: which dialog
 * a Mate's or a project's Delete opens, what goes and what stays, what the person must slide and
 * type before Delete opens, the one start it sends, and how HQ's deletion of the project stands.
 *
 * A project owns its code: HQ's repositories with their history, its changes and its releases go
 * with it. HQ runs its deletion as one operation (`app_deletion`) on the person's token, in a fixed
 * order: its last Mate first where it has one, then each Stage, then each Production the person
 * slid, then its code, so a stop anywhere leaves the most valuable things whole. Only a Production
 * Mate made, of a person who administers it, may go; any other stays in Zerops and Mate lets go of
 * it. Nothing on GitHub is touched. HQ decides every start again; this only chooses what to show.
 *
 * Pure.
 */
import {
  asSentence,
  operationFailureDetails,
  operationFailureWords,
  type HqOperationStanding,
} from "@t3tools/client-runtime/data";
import type { HqOperation, HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";

import { deleteMateConfirmed, lastMateGoes } from "./ZeropsDeleteMateDialog.logic";

/** A Stage or a Production of the project, as its deletion weighs it. */
export type DeletionEnvironment =
  | {
      readonly tier: "stage" | "production";
      readonly kind: "zerops";
      readonly projectId: string;
      /** Its Zerops project's name as HQ's structure gives it; `undefined` where it gives none. */
      readonly name: string | undefined;
      /** HQ's `delete_project` for the person: they administer its Zerops project. */
      readonly deletable: boolean;
      /** HQ proves Mate made it (`deleteProjectOnRemoval`): only such a Production may go. */
      readonly madeByMate: boolean;
    }
  | { readonly tier: "stage" | "production"; readonly kind: "git"; readonly branch: string };

/** The project a Delete is about, as HQ's structure holds it for the person. */
export interface DeletionProject {
  readonly appId: string;
  readonly name: string;
  /** HQ's placements in it, each by its kind there and its name. */
  readonly placements: ReadonlyArray<{
    readonly projectId: string;
    readonly kind: string;
    readonly name: string | undefined;
  }>;
  /** The projects of the births on their way into it (`null`: one that has none yet). */
  readonly births: ReadonlyArray<string | null>;
  /** HQ's `delete_app` for the person: an Owner or an Admin of the organization. */
  readonly deleteApp: boolean;
  readonly environments: ReadonlyArray<DeletionEnvironment>;
  /** The tiers of its Stages and Productions Zerops does not list to the person. */
  readonly hidden: ReadonlyArray<"stage" | "production">;
  /** HQ's deletion of it (`hqOperationOf` its `app_deletion`). */
  readonly deletion: HqOperationStanding;
  /** That deletion's parts in run order, as HQ's navigation names them; absent: none named. */
  readonly steps?: HqOperation["steps"];
}

export type DeletionFacts = { readonly past?: string | undefined } & (
  | {
      readonly mate: { readonly projectId: string; readonly name: string };
      readonly project?: DeletionProject | undefined;
    }
  | {
      readonly mate?: { readonly projectId: string; readonly name: string } | undefined;
      readonly project: DeletionProject;
    }
);

/** What deleting the whole project takes, before anything is slid. */
export interface ProjectDeletionPlan {
  /** Every Stage in Zerops: each goes, and each is slid before Delete opens. */
  readonly stages: ReadonlyArray<{ readonly projectId: string; readonly name: string }>;
  /** Each Production that may go: its name typed, then slid; one not slid stays. */
  readonly productions: ReadonlyArray<{ readonly projectId: string; readonly name: string }>;
  /** What stays whatever is slid, in words: other Productions, Git ones, hidden ones, GitHub. */
  readonly stays: ReadonlyArray<string>;
  /** Why the person cannot delete it (a Stage not theirs, a Mate in it); absent: they can. */
  readonly refusal?: string;
}

/** Which dialog a Delete opens (design §2), the one answer both dialogs and both menus render. */
export type DeletionOffer =
  /** A Mate that is not its project's last (`stays`: what stays), or one in no project. */
  | { readonly kind: "mate"; readonly projectId: string; readonly stays: string | undefined }
  /** The last Mate, the project not the person's to delete: only the Mate goes, keeping its code. */
  | { readonly kind: "last-mate-only"; readonly projectId: string; readonly stays: string }
  /** The last Mate of a project the person may delete whole: they choose. */
  | {
      readonly kind: "last-choice";
      readonly projectId: string;
      readonly appId: string;
      readonly plan: ProjectDeletionPlan;
    }
  /** A project without a Mate, from its own Delete or Delete again. */
  | { readonly kind: "project"; readonly appId: string; readonly plan: ProjectDeletionPlan }
  /** HQ's deletion of the project runs, waits or ended failed: its state, no form. */
  | {
      readonly kind: "standing";
      readonly deletion: Extract<HqOperationStanding, { kind: "going" | "waiting" | "failed" }>;
    };

/** HQ's kinds of a project that keep a Mate from being its project's last (`app_has_mate`). */
const HOLDING_KINDS: ReadonlySet<string> = new Set(["mate", "devstage", "plain"]);
const MATE_KINDS: ReadonlySet<string> = new Set(["mate", "devstage"]);

/** Placements and births HQ says hold the project, except the Mate being deleted. */
function otherHolders(project: DeletionProject, projectId: string | undefined) {
  return {
    placements: project.placements.filter(
      (placement) => HOLDING_KINDS.has(placement.kind) && placement.projectId !== projectId,
    ),
    births: project.births.filter((birth) => birth !== projectId),
  };
}

function listed(names: ReadonlyArray<string>): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
}

/** "its code, Stage and Production": what the project keeps, naming only what it has. */
function keptWith(project: DeletionProject): string {
  const has = (tier: "stage" | "production") =>
    project.environments.some((environment) => environment.tier === tier) ||
    project.hidden.includes(tier);
  return listed([
    "its code",
    ...(has("stage") ? ["Stage"] : []),
    ...(has("production") ? ["Production"] : []),
  ]);
}

/** What deleting the whole project takes, and why the person may not where they may not. */
export function projectDeletionPlan(
  project: DeletionProject,
  mate: DeletionFacts["mate"],
): ProjectDeletionPlan {
  const zerops = project.environments.flatMap((environment) =>
    environment.kind === "zerops" ? [environment] : [],
  );
  const stages = zerops.filter((environment) => environment.tier === "stage");
  const productions = zerops.filter((environment) => environment.tier === "production");
  const goes = (environment: (typeof zerops)[number]) =>
    environment.deletable && environment.madeByMate && environment.name !== undefined;
  const notTheirs = stages.find((stage) => !stage.deletable || stage.name === undefined);
  const holders = otherHolders(project, mate?.projectId);
  const otherMate =
    holders.births.length > 0 ||
    holders.placements.some((placement) => MATE_KINDS.has(placement.kind));
  const refusal = otherMate
    ? "A Mate still works on this project. Delete it first."
    : holders.placements.length > 0
      ? "A plain project still belongs to this project. Remove it first."
      : notTheirs !== undefined
        ? notTheirs.name === undefined
          ? "Deleting it would delete a Stage you have no access to."
          : `Deleting it would delete Stage ${notTheirs.name}, and you are not an Admin of it.`
        : project.hidden.includes("stage")
          ? "Deleting it would delete a Stage you have no access to."
          : undefined;
  return {
    stages: stages.map((stage) => ({ projectId: stage.projectId, name: stage.name ?? "" })),
    productions: productions.flatMap((production) =>
      goes(production) ? [{ projectId: production.projectId, name: production.name! }] : [],
    ),
    stays: [
      ...productions.flatMap((production) =>
        goes(production) ? [] : [productionStaysWords(production.name)],
      ),
      ...project.environments.flatMap((environment) =>
        environment.kind === "git" && environment.tier === "production"
          ? [`Production on Git branch ${environment.branch}. Nothing to delete in Zerops.`]
          : [],
      ),
      ...project.hidden.flatMap((tier) =>
        tier === "production" ? ["A Production you have no access to stays in Zerops."] : [],
      ),
      "Anything on GitHub",
    ],
    ...(refusal === undefined ? {} : { refusal }),
  };
}

/** A Zerops Production that stays, by its name; one HQ's structure gives no name is still said. */
export function productionStaysWords(name: string | undefined): string {
  return name === undefined || name === ""
    ? "Its Production stays in Zerops and keeps running. Mate lets go of it."
    : `Production ${name} stays in Zerops and keeps running. Mate lets go of it.`;
}

/**
 * Which dialog a Delete opens. A Mate that is not its project's last — another Mate, a plain
 * project or a birth stands in it, HQ's own rule — goes alone. The last Mate of a project the
 * person may not delete whole (not an Owner or an Admin, or a Stage not theirs) goes alone, its
 * project kept with the reason. Otherwise the person chooses the Mate alone or the whole project.
 * A project HQ deletes, waits on or failed to delete shows that, until Delete again.
 */
export function deletionOffer(facts: DeletionFacts): DeletionOffer {
  const { project } = facts;
  const mate =
    facts.mate !== undefined &&
    (project === undefined ||
      project.placements.some(
        (placement) =>
          MATE_KINDS.has(placement.kind) && placement.projectId === facts.mate?.projectId,
      ) ||
      project.births.includes(facts.mate.projectId))
      ? facts.mate
      : undefined;
  if (project !== undefined) {
    const deletion = project.deletion;
    if (
      deletion.kind === "going" ||
      deletion.kind === "waiting" ||
      (deletion.kind === "failed" && deletion.id !== facts.past)
    )
      return { kind: "standing", deletion };
  }
  if (project === undefined)
    return { kind: "mate", projectId: facts.mate!.projectId, stays: undefined };
  const plan = projectDeletionPlan(project, mate);
  if (mate === undefined) return { kind: "project", appId: project.appId, plan };
  const { placements: others, births } = otherHolders(project, mate.projectId);
  if (others.length > 0 || births.length > 0) {
    const otherMates =
      births.length > 0 || others.some((placement) => MATE_KINDS.has(placement.kind));
    return {
      kind: "mate",
      projectId: mate.projectId,
      stays: `${project.name} stays, with its code${otherMates ? " and its other Mates" : ""}.`,
    };
  }
  const last = `${mate.name} is the last Mate of ${project.name}.`;
  if (!project.deleteApp)
    return {
      kind: "last-mate-only",
      projectId: mate.projectId,
      stays: `${last} ${project.name} stays, with ${keptWith(project)}: only an Owner or an Admin can delete a project.`,
    };
  if (plan.refusal !== undefined)
    return {
      kind: "last-mate-only",
      projectId: mate.projectId,
      stays: `${last} ${project.name} stays: ${plan.refusal.charAt(0).toLowerCase()}${plan.refusal.slice(1)}`,
    };
  return { kind: "last-choice", projectId: mate.projectId, appId: project.appId, plan };
}

/** The last Mate's choice, in words: its description and what each of its two choices takes. */
export function lastChoiceWords(
  project: DeletionProject,
  plan: ProjectDeletionPlan,
  mate: string,
  /** The Productions slid, by project id: the whole project's choice names each. */
  slid: ReadonlySet<string>,
): {
  readonly description: string;
  readonly only: { readonly title: string; readonly line: string };
  readonly whole: { readonly title: string; readonly line: string };
} {
  return {
    description: `${mate} is the last Mate of ${project.name}. Choose what goes.`,
    only: {
      title: `Only ${mate}`,
      line: `${project.name} stays, with ${keptWith(project)}. Start a new Mate in it any time.`,
    },
    whole: {
      title: `${mate} and the whole project`,
      line: `${listed([
        project.name,
        "its code",
        ...(plan.stages.length === 0 ? [] : ["Stage"]),
        ...plan.productions.flatMap((production) =>
          slid.has(production.projectId) ? [`Production ${production.name}`] : [],
        ),
      ])} go. This can't be undone.`,
    },
  };
}

/** HQ's structure of the project, as `deletionOffer` reads it; `undefined` where it holds none. */
export function deletionProjectOf(
  structure: Pick<HqStructure, "can" | "apps"> | null | undefined,
  appId: string | undefined,
  deletion: HqOperationStanding,
): DeletionProject | undefined {
  const app = structure?.apps.find(({ id }) => id === appId);
  if (app === undefined) return undefined;
  const named = new Map(app.projects.map((project) => [project.projectId, project.name]));
  return {
    appId: app.id,
    name: app.name,
    placements: app.projects.map(({ projectId, kind, name }) => ({ projectId, kind, name })),
    births: (app.births ?? []).map((birth) => birth.projectId ?? null),
    deleteApp: hqOffer(structure?.can, "delete_app").kind === "allowed",
    environments: (app.environments ?? []).map((environment): DeletionEnvironment => {
      const target = environment.target;
      return target.kind === "git"
        ? { tier: environment.tier, kind: "git", branch: target.branch }
        : {
            tier: environment.tier,
            kind: "zerops",
            projectId: target.projectId,
            name: named.get(target.projectId),
            deletable: hqOffer(environment.can, "delete_project").kind === "allowed",
            madeByMate: environment.deleteProjectOnRemoval === true,
          };
    }),
    hidden: (app.hiddenEnvironments ?? []).map((hidden) => hidden.tier),
    deletion,
    ...(app.operation?.steps === undefined ? {} : { steps: app.operation.steps }),
  };
}

/** What HQ holds of the project: its repositories by name, and how many changes are open. */
export interface ApplicationHoldings {
  readonly repos: ReadonlyArray<string>;
  readonly openChanges: number;
}

/** HQ's detail of the project, once it said both its repositories and its changes. */
export function applicationHoldings(detail: {
  readonly repos: ReadonlyArray<{ readonly name: string }> | undefined;
  readonly changes: ReadonlyArray<{ readonly state: string }> | undefined;
}): ApplicationHoldings | undefined {
  if (detail.repos === undefined || detail.changes === undefined) return undefined;
  return {
    repos: detail.repos.map((repo) => repo.name),
    openChanges: detail.changes.filter((change) => change.state === "open").length,
  };
}

/** What the person slid and typed in the project's dialog. */
export interface DeletionConfirmation {
  /** The Stages and Productions slid, by project id. */
  readonly slid: ReadonlySet<string>;
  /** Each Production's name as typed, by project id. */
  readonly productionTyped: Readonly<Record<string, string>>;
}

export interface ProjectDeletionWords {
  /** "Delete shop?" */
  readonly title: string;
  /** Each thing that goes; `undefined` until HQ said what the project holds. */
  readonly goes: ReadonlyArray<string> | undefined;
  readonly stays: ReadonlyArray<string>;
  /** "Type shop to confirm" */
  readonly label: string;
  /** "Delete shop" */
  readonly submit: string;
}

/** What deleting the whole project takes and leaves, by what the person slid. */
export function projectDeletionWords(input: {
  readonly name: string;
  readonly plan: ProjectDeletionPlan;
  readonly holdings: ApplicationHoldings | undefined;
  /** Its last Mate, which goes first; its services as `deleteMateServiceCount`. */
  readonly mate?: { readonly name: string; readonly services: number | undefined } | undefined;
  readonly slid: ReadonlySet<string>;
}): ProjectDeletionWords {
  const { name, plan, holdings, mate, slid } = input;
  const code = holdings?.repos.filter((repo) => repo !== RECIPE_REPO) ?? [];
  return {
    title: `Delete ${name}?`,
    goes:
      holdings === undefined
        ? undefined
        : [
            ...(mate === undefined ? [] : [lastMateGoes(mate.name, mate.services)]),
            ...(code.length === 0
              ? []
              : [
                  code.length === 1
                    ? `Repository ${code[0]!}, with its history`
                    : `Repositories ${listed(code)}, with their history`,
                ]),
            ...(holdings.repos.includes(RECIPE_REPO) ? ["Its setup files"] : []),
            ...(holdings.openChanges === 0
              ? []
              : [
                  holdings.openChanges === 1
                    ? "1 open change"
                    : `${String(holdings.openChanges)} open changes`,
                ]),
            ...plan.stages.map(
              (stage) => `Stage ${stage.name} goes from Zerops, with everything in it`,
            ),
            ...plan.productions.flatMap((production) =>
              slid.has(production.projectId)
                ? [`Production ${production.name} goes from Zerops, with its services and data`]
                : [],
            ),
          ],
    stays: [
      ...plan.productions.flatMap((production) =>
        slid.has(production.projectId) ? [] : [productionStaysWords(production.name)],
      ),
      ...plan.stays,
    ],
    label: `Type ${name} to confirm`,
    submit: `Delete ${name}`,
  };
}

/**
 * A Production's own block in the project's dialog: what cannot be undone, the field its Zerops
 * project's name is typed in to unlock its slide, and the slide's words.
 */
export function productionDeletionWords(name: string): {
  readonly warning: string;
  readonly label: string;
  readonly slide: string;
  readonly slid: string;
} {
  return {
    warning: `Deleting Production ${name} takes it offline at once. Its services and data go from Zerops; Zerops keeps its backups for 7 days and then destroys them. Nobody can bring it back after that.`,
    label: `Type ${name} to unlock`,
    slide: `Slide to delete Production ${name}`,
    slid: `Production ${name} will be deleted`,
  };
}

/** A Production goes only while its own typed name and slide both confirm it. */
export function productionConfirmed(typed: string, name: string, slid: boolean): boolean {
  return slid && deleteMateConfirmed(typed, name);
}

/** Whether every Stage is slid and the project's name is confirmed; also the parts confirmed. */
export function projectDeletionReady(
  plan: ProjectDeletionPlan,
  confirmation: DeletionConfirmation,
  confirmed: boolean,
): {
  readonly ready: boolean;
  readonly missing: string | null;
  readonly slid: ReadonlySet<string>;
} {
  const slid = new Set([
    ...plan.stages
      .filter((stage) => confirmation.slid.has(stage.projectId))
      .map((stage) => stage.projectId),
    ...plan.productions
      .filter((production) =>
        productionConfirmed(
          confirmation.productionTyped[production.projectId] ?? "",
          production.name,
          confirmation.slid.has(production.projectId),
        ),
      )
      .map((production) => production.projectId),
  ]);
  if (plan.refusal !== undefined) return { ready: false, missing: plan.refusal, slid };
  if (plan.stages.some((stage) => !slid.has(stage.projectId)))
    return { ready: false, missing: "Slide each Stage to confirm.", slid };
  return { ready: confirmed, missing: null, slid };
}

/** One start, entirely from the offer rendered at the press and the person's choice. */
export function deletionStart(input: {
  readonly orgId: string;
  readonly id: string;
  readonly offer: DeletionOffer;
  readonly choice:
    | { readonly kind: "mate" }
    | ({ readonly kind: "project" } & DeletionConfirmation);
}):
  | {
      readonly kind: "start-mate-deletion";
      readonly orgId: string;
      readonly projectId: string;
      readonly id: string;
      readonly keptGit?: "keep";
    }
  | {
      readonly kind: "start-app-deletion";
      readonly orgId: string;
      readonly appId: string;
      readonly id: string;
      readonly stages: ReadonlyArray<string>;
      readonly mate?: string;
      readonly productions?: ReadonlyArray<string>;
    }
  | undefined {
  const { orgId, id, offer, choice } = input;
  if (offer.kind === "standing") return undefined;
  if (
    offer.kind === "mate" ||
    offer.kind === "last-mate-only" ||
    (offer.kind === "last-choice" && choice.kind === "mate")
  ) {
    return {
      kind: "start-mate-deletion",
      orgId,
      id,
      projectId: offer.projectId,
      ...(offer.kind === "mate" ? {} : { keptGit: "keep" as const }),
    };
  }
  if (choice.kind !== "project") return undefined;
  const productions = offer.plan.productions.flatMap((production) =>
    productionConfirmed(
      choice.productionTyped[production.projectId] ?? "",
      production.name,
      choice.slid.has(production.projectId),
    )
      ? [production.projectId]
      : [],
  );
  return {
    kind: "start-app-deletion",
    orgId,
    appId: offer.appId,
    id,
    stages: offer.plan.stages.map((stage) => stage.projectId),
    ...(offer.kind === "last-choice" ? { mate: offer.projectId } : {}),
    ...(productions.length === 0 ? {} : { productions }),
  };
}

/** HQ permits reuse of an id only for the same start body. */
export function sameDeletionStart(
  left: NonNullable<ReturnType<typeof deletionStart>>,
  right: NonNullable<ReturnType<typeof deletionStart>>,
): boolean {
  if (left.kind !== right.kind || left.orgId !== right.orgId) return false;
  if (left.kind === "start-mate-deletion" && right.kind === "start-mate-deletion")
    return left.projectId === right.projectId && left.keptGit === right.keptGit;
  if (left.kind === "start-app-deletion" && right.kind === "start-app-deletion")
    return (
      left.appId === right.appId &&
      left.mate === right.mate &&
      JSON.stringify(left.stages) === JSON.stringify(right.stages) &&
      JSON.stringify(left.productions ?? []) === JSON.stringify(right.productions ?? [])
    );
  return false;
}

/** One part of HQ's deletion of the project, as its dialog lists it. */
export interface DeletionPart {
  readonly part: "mate" | "stage" | "production" | "code";
  /** "Stage shop-stage", "Quinn", "Its code". */
  readonly label: string;
  /**
   * `stopped`: the part a waiting deletion stopped at, to which nothing is sent while it waits;
   * `here`: not gone, in a deletion that ended failed, so nothing deletes it any more.
   */
  readonly state: "gone" | "deleting" | "pending" | "stopped" | "here";
}

const PART_STATES: ReadonlySet<string> = new Set(["gone", "deleting", "pending"]);

/**
 * HQ's parts of the deletion, named by its plan; an unknown part is passed by.
 * While it waits, the part it was deleting is stopped there; once it ended failed, a part not
 * gone is still here, whatever step it stopped at.
 */
export function deletionParts(project: DeletionProject): ReadonlyArray<DeletionPart> {
  return (project.steps ?? []).flatMap((step): ReadonlyArray<DeletionPart> => {
    if (!PART_STATES.has(step.state)) return [];
    const state: DeletionPart["state"] =
      project.deletion.kind === "failed" && step.state !== "gone"
        ? "here"
        : project.deletion.kind === "waiting" && step.state === "deleting"
          ? "stopped"
          : (step.state as DeletionPart["state"]);
    const named = step.name;
    switch (step.part) {
      case "mate":
        return [{ part: "mate", label: named ?? "Its Mate", state }];
      case "stage":
        return [
          { part: "stage", label: named === undefined ? "A Stage" : `Stage ${named}`, state },
        ];
      case "production":
        return [
          {
            part: "production",
            label: named === undefined ? "A Production" : `Production ${named}`,
            state,
          },
        ];
      case "code":
        return [{ part: "code", label: "Its code", state }];
      default:
        return [];
    }
  });
}

const lowerFirst = (label: string) =>
  label.startsWith("Its ") || label.startsWith("A ")
    ? label.charAt(0).toLowerCase() + label.slice(1)
    : label;

/**
 * How HQ's deletion of the project stands, in words: the part it deletes while it runs, the part
 * it stopped at while it waits (`at`, the dialog adds whose Continue), and where it ended failed,
 * Zerops' or HQ's reason with what is gone and what is still here.
 */
export function deletionStandingWords(
  project: DeletionProject,
  deletion: Extract<HqOperationStanding, { kind: "going" | "waiting" | "failed" }>,
): {
  readonly line: string;
  readonly failed: boolean;
  readonly details: string | null;
  readonly parts: ReadonlyArray<DeletionPart>;
} {
  const parts = deletionParts(project);
  const at =
    parts.find((part) => part.state === "deleting" || part.state === "stopped") ??
    parts.find((part) => part.state === "pending");
  if (deletion.kind === "going")
    return {
      line: at === undefined ? "Deleting…" : `Deleting ${lowerFirst(at.label)}…`,
      failed: false,
      details: null,
      parts,
    };
  if (deletion.kind === "waiting")
    return {
      line: at === undefined ? "Deleting stopped" : `Deleting stopped at ${lowerFirst(at.label)}`,
      failed: false,
      details: null,
      parts,
    };
  const gone = parts.filter((part) => part.state === "gone");
  const standing = parts.filter((part) => part.state !== "gone");
  const goneLabel = (part: DeletionPart) =>
    part.part === "mate" ? `${lowerFirst(part.label)}'s workspace` : lowerFirst(part.label);
  return {
    line: [
      `${project.name} was not deleted · ${asSentence(operationFailureWords(deletion.failure))}`,
      ...(gone.length === 0 ? [] : [`Gone: ${listed(gone.map(goneLabel))}.`]),
      ...(standing.length === 0
        ? []
        : [`Still here: ${listed(standing.map((part) => lowerFirst(part.label)))}.`]),
    ].join(" "),
    failed: true,
    details: operationFailureDetails(deletion.failure),
    parts,
  };
}
