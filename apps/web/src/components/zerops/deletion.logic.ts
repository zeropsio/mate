/** Pure decisions for a Mate's or project's deletion and HQ's recorded deletion. */
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
    readonly deletable: boolean;
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

/** Which surface a Delete opens. */
export type DeletionOffer =
  | { readonly kind: "mate"; readonly projectId: string; readonly stays: string | undefined }
  | { readonly kind: "last-mate-only"; readonly projectId: string; readonly stays: string }
  | { readonly kind: "project"; readonly appId: string; readonly mate?: DeletionFacts["mate"] }
  | {
      readonly kind: "standing";
      readonly deletion: Extract<HqOperationStanding, { kind: "going" | "waiting" | "failed" }>;
    };

const MATE_KINDS: ReadonlySet<string> = new Set(["mate", "devstage"]);

/** Other Mates and births, excluding the Mate this page names. */
function otherHolders(project: DeletionProject, projectId: string | undefined) {
  return {
    placements: project.placements.filter(
      (placement) => MATE_KINDS.has(placement.kind) && placement.projectId !== projectId,
    ),
    births: project.births.filter((birth) => birth !== projectId),
  };
}

function listed(names: ReadonlyArray<string>): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
}

/** A Mate goes alone when another Mate or birth stands, or the reader cannot delete the project. */
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
  if (project === undefined)
    return { kind: "mate", projectId: facts.mate!.projectId, stays: undefined };
  const { deletion } = project;
  if (deletion.kind === "going" || deletion.kind === "waiting")
    return { kind: "standing", deletion };
  if (mate !== undefined) {
    const { placements: others, births } = otherHolders(project, mate.projectId);
    if (others.length > 0 || births.length > 0) {
      return {
        kind: "mate",
        projectId: mate.projectId,
        stays: `${project.name} stays, with its code and its other Mates.`,
      };
    }
    if (!project.deleteApp) {
      const review = deletionReview({
        project,
        mate,
        holdings: undefined,
        choice: everythingStays(project),
      });
      return {
        kind: "last-mate-only",
        projectId: mate.projectId,
        stays: `${mate.name} is the last Mate of ${project.name}. ${project.name} stays, with ${listed(["its code", ...review.mateStaysParts])}: only an Owner or an Admin can delete a project.`,
      };
    }
  }
  if (deletion.kind === "failed" && deletion.id !== facts.past)
    return { kind: "standing", deletion };
  return { kind: "project", appId: project.appId, ...(mate === undefined ? {} : { mate }) };
}

const DELETE_PROJECT_WHO = "Only an Owner or an Admin can delete a project.";

/** The Mate named by a failed deletion's start, or the Mate the page's address names. */
export function deletionPageMate(input: {
  readonly project: DeletionProject | undefined;
  readonly address: string | undefined;
}): string | undefined {
  const { project, address } = input;
  if (project?.deletion.kind !== "failed") return address;
  const mate = project.steps?.find(
    ({ part, projectId }) => part === "mate" && projectId !== undefined,
  );
  return mate?.projectId ?? address;
}

/** The page renders this answer, including an existing operation for every reader. */
export function deletionPageState(input: {
  readonly structureRead: boolean;
  readonly project: DeletionProject | undefined;
  readonly mate: { readonly projectId: string; readonly name: string } | undefined;
  readonly past?: string | undefined;
}):
  | { readonly kind: "reading" }
  | { readonly kind: "gone" }
  | { readonly kind: "refused"; readonly project: DeletionProject; readonly line: string }
  | {
      readonly kind: "standing";
      readonly project: DeletionProject;
      readonly offer: Extract<DeletionOffer, { kind: "standing" }>;
    }
  | {
      readonly kind: "form";
      readonly project: DeletionProject;
      readonly offer: Extract<DeletionOffer, { kind: "project" }>;
      readonly failedDeletion?: Extract<HqOperationStanding, { kind: "failed" }> | undefined;
    } {
  if (!input.structureRead) return { kind: "reading" };
  if (input.project === undefined) return { kind: "gone" };
  const offer = deletionOffer({ project: input.project, mate: input.mate, past: input.past });
  if (offer.kind === "standing") {
    if (offer.deletion.kind === "failed" && !offer.deletion.again && input.project.deleteApp) {
      const fresh = deletionOffer({
        project: input.project,
        mate: input.mate,
        past: offer.deletion.id,
      });
      if (fresh.kind === "project")
        return {
          kind: "form",
          project: input.project,
          offer: fresh,
          failedDeletion: offer.deletion,
        };
    }
    return { kind: "standing", project: input.project, offer };
  }
  if (offer.kind === "mate" || offer.kind === "last-mate-only")
    return { kind: "refused", project: input.project, line: offer.stays ?? "" };
  if (offer.kind === "project" && !input.project.deleteApp)
    return {
      kind: "refused",
      project: input.project,
      line: DELETE_PROJECT_WHO,
    };
  return { kind: "form", project: input.project, offer };
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
    placements: app.projects.map(({ projectId, kind, name, can }) => ({
      projectId,
      kind,
      name,
      deletable: hqOffer(can, "delete_project").kind === "allowed",
    })),
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

/** What HQ holds of the project. */
export interface ApplicationHoldings {
  readonly repos: ReadonlyArray<{ readonly name: string; readonly canKeep: boolean }>;
  readonly openChanges: number;
}

export function applicationHoldings(detail: {
  readonly repos:
    | ReadonlyArray<{ readonly name: string; readonly canKeep?: { readonly allow: boolean } }>
    | undefined;
  readonly changes: ReadonlyArray<{ readonly state: string }> | undefined;
}): ApplicationHoldings | undefined {
  if (detail.repos === undefined || detail.changes === undefined) return undefined;
  return {
    repos: detail.repos.map((repo) => ({ name: repo.name, canKeep: repo.canKeep?.allow === true })),
    openChanges: detail.changes.filter((change) => change.state === "open").length,
  };
}

export interface DeletionChoice {
  readonly fates: Readonly<Record<string, "goes" | "stays">>;
  readonly repoFates: Readonly<Record<string, "goes" | "stays">>;
  readonly slid: Readonly<Record<string, boolean>>;
  readonly projectName: string;
  /** A stopped operation's code selection, including repositories read after the form opens. */
  readonly codeAgain?: { readonly hasStep: boolean; readonly keeps: ReadonlyArray<string> };
}

export interface DeletionRow {
  readonly kind: "mate" | "plain" | "stage" | "production" | "code" | "setup";
  readonly id: string;
  readonly title: string;
  readonly badge: string;
  readonly fate: "goes" | "stays";
  readonly switchable: boolean;
  readonly line: string;
  readonly summary: string;
  readonly slide?: {
    readonly label: string;
    readonly confirmedLabel: string;
    readonly missing: string;
    readonly confirmed: boolean;
  };
  readonly warning?: string;
}

type DeletionStartBody =
  | { readonly kind: "start-mate-deletion"; readonly projectId: string; readonly keptGit?: "keep" }
  | {
      readonly kind: "start-app-deletion";
      readonly appId: string;
      readonly stages: ReadonlyArray<string>;
      readonly mate?: string;
      readonly plains?: ReadonlyArray<string>;
      readonly productions?: ReadonlyArray<string>;
      readonly keepRepos?: ReadonlyArray<string>;
      readonly names?: Readonly<Record<string, string>>;
    };

/** Start with all project parts staying, as the Mate's own deletion does. */
export function everythingStays(project: DeletionProject): DeletionChoice {
  const ids = [
    ...project.placements
      .filter((placement) => placement.kind === "plain")
      .map((placement) => placement.projectId),
    ...project.environments.flatMap((environment) =>
      environment.kind === "zerops" ? [environment.projectId] : [],
    ),
  ];
  return {
    fates: Object.fromEntries(ids.map((id) => [id, "stays"])),
    repoFates: {},
    slid: {},
    projectName: "",
  };
}

/** Project ids and repository names are independent namespaces. */
export function chooseDeletionFate(
  choice: DeletionChoice,
  row: DeletionRow,
  fate: "goes" | "stays",
): DeletionChoice {
  if (row.kind === "code" || row.kind === "setup")
    return { ...choice, repoFates: { ...choice.repoFates, [row.id]: fate } };
  const slid = { ...choice.slid };
  if (fate === "stays") delete slid[row.id];
  return { ...choice, fates: { ...choice.fates, [row.id]: fate }, slid };
}

/** A failed deletion's recorded steps are the only source of its next choice. */
export function deletionChoiceAgain(
  project: DeletionProject,
  holdings: ApplicationHoldings | undefined,
): DeletionChoice {
  const steps: NonNullable<DeletionProject["steps"]> = project.steps ?? [];
  const named = new Set(
    steps.flatMap((step) => (step.projectId === undefined ? [] : [step.projectId])),
  );
  const code = steps.find((step) => step.part === "code");
  const keeps = new Set(code?.keeps ?? []);
  const choice = everythingStays(project);
  const fates: Record<string, "goes" | "stays"> = { ...choice.fates };
  for (const id of Object.keys(fates)) fates[id] = named.has(id) ? "goes" : "stays";
  const repoFates = Object.fromEntries(
    (holdings?.repos ?? []).map((repo) => [
      repo.name,
      code !== undefined && !keeps.has(repo.name) ? ("goes" as const) : ("stays" as const),
    ]),
  );
  return {
    fates,
    repoFates,
    slid: {},
    projectName: "",
    codeAgain: { hasStep: code !== undefined, keeps: code?.keeps ?? [] },
  };
}

/** One answer for every row, the result, the holds and the exact start. */
export function deletionReview(input: {
  readonly project: DeletionProject;
  readonly mate?:
    | { readonly projectId: string; readonly name: string; readonly services?: number | undefined }
    | undefined;
  readonly holdings: ApplicationHoldings | undefined;
  readonly choice: DeletionChoice;
}) {
  const { project, mate, holdings, choice } = input;
  const rows: DeletionRow[] = [];
  if (mate !== undefined)
    rows.push({
      kind: "mate",
      id: mate.projectId,
      title: mate.name,
      badge: "Mate",
      fate: "goes",
      switchable: false,
      line: `Goes first, with its conversations and its workspace in Zerops${mate.services === undefined || mate.services === 0 ? "" : mate.services === 1 ? " and its 1 service" : ` and its ${String(mate.services)} services`}`,
      summary: lastMateGoes(mate.name, mate.services),
    });
  const addPart = (part: {
    kind: "plain" | "stage" | "production";
    id: string;
    name: string | undefined;
    deletable: boolean;
    madeByMate: boolean;
  }) => {
    const { kind, id, deletable, madeByMate } = part;
    const name = part.name?.trim() ? part.name : undefined;
    const title =
      name === undefined
        ? kind === "plain"
          ? "A Zerops project"
          : kind === "stage"
            ? "A Stage"
            : "A Production"
        : `${kind === "plain" ? "Zerops project" : kind === "stage" ? "Stage" : "Production"} ${name}`;
    const switchable =
      kind === "production" && !madeByMate ? true : deletable && name !== undefined;
    const defaultFate = kind === "stage" && switchable ? "goes" : "stays";
    const fate = switchable ? (choice.fates[id] ?? defaultFate) : "stays";
    const needsSlide =
      fate === "goes" &&
      name !== undefined &&
      (kind === "plain" || (kind === "production" && madeByMate));
    const letsGo = kind === "production" && !madeByMate && fate === "goes";
    const line = !switchable
      ? name === undefined
        ? "You have no access to it."
        : "You are not an Admin of it."
      : letsGo
        ? "Leaves this project. It keeps running in Zerops: Mate did not make it."
        : fate === "stays"
          ? kind === "stage"
            ? "Stays in this project"
            : "Stays in this project and keeps running"
          : kind === "production"
            ? "Goes from Zerops, with its services and data"
            : "Goes from Zerops, with everything in it";
    const summary =
      fate === "stays"
        ? title
        : letsGo
          ? `${title} stays in Zerops and keeps running. Mate lets go of it.`
          : `${title} ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
    rows.push({
      kind,
      id,
      title,
      badge: kind === "plain" ? "Zerops project" : kind === "stage" ? "Stage" : "Production",
      fate,
      switchable,
      line,
      summary,
      ...(needsSlide
        ? {
            slide: {
              label: `Slide to delete ${title}`,
              confirmedLabel: `${title} goes`,
              missing: `Slide ${title} to confirm it goes.`,
              confirmed: choice.slid[id] === true,
            },
          }
        : {}),
      ...(needsSlide && kind === "production" && name !== undefined
        ? { warning: productionDeletionWords(name).warning }
        : {}),
    });
  };
  for (const plain of project.placements.filter((placement) => placement.kind === "plain"))
    addPart({
      kind: "plain",
      id: plain.projectId,
      name: plain.name,
      deletable: plain.deletable,
      madeByMate: false,
    });
  for (const tier of ["stage", "production"] as const) {
    for (const env of project.environments)
      if (env.kind === "zerops" && env.tier === tier)
        addPart({
          kind: tier,
          id: env.projectId,
          name: env.name,
          deletable: env.deletable,
          madeByMate: env.madeByMate,
        });
    const hiddenParts: DeletionProject["hidden"] = project.hidden;
    hiddenParts.forEach((hidden, index) => {
      if (hidden === tier)
        addPart({
          kind: tier,
          id: `hidden:${tier}:${String(index)}`,
          name: undefined,
          deletable: false,
          madeByMate: true,
        });
    });
  }
  const parts = rows.filter(
    (row) => row.kind === "plain" || row.kind === "stage" || row.kind === "production",
  );
  const partStays = parts.some((row) => row.fate === "stays");
  const repos = holdings?.repos.filter((repo) => repo.name !== RECIPE_REPO) ?? [];
  for (const repo of repos) {
    const switchable = !partStays && repo.canKeep;
    const recorded = choice.codeAgain;
    const defaultFate =
      recorded !== undefined && (!recorded.hasStep || recorded.keeps.includes(repo.name))
        ? "stays"
        : "goes";
    const chosenFate = Object.hasOwn(choice.repoFates, repo.name)
      ? choice.repoFates[repo.name]
      : undefined;
    const fate = partStays ? "stays" : switchable ? (chosenFate ?? defaultFate) : "goes";
    rows.push({
      kind: "code",
      id: repo.name,
      title: repo.name,
      badge: "Repository",
      fate,
      switchable,
      line: partStays
        ? "Stays while the project keeps something in Zerops."
        : fate === "goes"
          ? "Goes with its history and branches"
          : "Stays, with its history and branches",
      summary:
        fate === "goes" ? `Repository ${repo.name}, with its history` : `Repository ${repo.name}`,
    });
  }
  if (holdings?.repos.some((repo) => repo.name === RECIPE_REPO)) {
    const repoStays = rows.some((row) => row.kind === "code" && row.fate === "stays");
    const switchable = mate !== undefined && parts.length === 0 && repos.length === 0;
    const recorded = choice.codeAgain;
    const defaultFate =
      recorded !== undefined && (!recorded.hasStep || recorded.keeps.includes(RECIPE_REPO))
        ? "stays"
        : "goes";
    const chosenFate = Object.hasOwn(choice.repoFates, RECIPE_REPO)
      ? choice.repoFates[RECIPE_REPO]
      : undefined;
    const fate =
      partStays || repoStays ? "stays" : switchable ? (chosenFate ?? defaultFate) : "goes";
    rows.push({
      kind: "setup",
      id: RECIPE_REPO,
      title: "Setup files",
      badge: "Setup files",
      fate,
      switchable,
      line:
        fate === "stays"
          ? "Stay with the project."
          : "Go with the project: they describe its Stages and Productions",
      summary: "Its setup files",
    });
  }
  const stayedParts = parts.filter((row) => row.fate === "stays");
  const keptKinds = [
    ...(stayedParts.some((row) => row.kind === "plain") ? ["Zerops project"] : []),
    ...(stayedParts.some((row) => row.kind === "stage") ? ["Stage"] : []),
    ...(stayedParts.some((row) => row.kind === "production") ? ["Production"] : []),
  ];
  const mateStaysParts = [
    ...(keptKinds.includes("Zerops project") ? ["Zerops project"] : []),
    ...(keptKinds.includes("Stage") ||
    project.environments.some((env) => env.kind === "git" && env.tier === "stage")
      ? ["Stage"]
      : []),
    ...(keptKinds.includes("Production") ||
    project.environments.some((env) => env.kind === "git" && env.tier === "production")
      ? ["Production"]
      : []),
  ];
  const codeStays = rows.some(
    (row) => (row.kind === "code" || row.kind === "setup") && row.fate === "stays",
  );
  const place: "menu" | "git" | "gone" = partStays
    ? "menu"
    : codeStays || holdings === undefined
      ? "git"
      : "gone";
  const becomes = {
    place,
    parts: keptKinds,
    line:
      place === "menu"
        ? `It stays in the menu with its ${listed(keptKinds)}; its row's menu deletes the rest any time.`
        : place === "git"
          ? "It leaves the menu and waits under Git, Kept code: add a Mate to it or delete it there any time."
          : "Nothing of it stays. This can't be undone.",
  };
  const gone = rows.filter((row) => row.fate === "goes");
  const goneRepos = gone.filter((row) => row.kind === "code" || row.kind === "setup");
  const stays = rows.filter((row) => row.fate === "stays").map((row) => row.summary);
  stays.push(
    ...project.environments.flatMap((env) =>
      env.kind === "git" && env.tier === "production"
        ? [`Production on Git branch ${env.branch}. Nothing to delete in Zerops.`]
        : [],
    ),
    "Anything on GitHub",
  );
  const goes = holdings === undefined ? undefined : gone.map((row) => row.summary);
  if (
    goes !== undefined &&
    holdings !== undefined &&
    holdings.openChanges > 0 &&
    goneRepos.length > 0
  )
    goes.push(
      goneRepos.length === holdings.repos.length
        ? `${String(holdings.openChanges)} open change${holdings.openChanges === 1 ? "" : "s"}`
        : "Open changes in the repositories that go",
    );
  const holders = otherHolders(project, mate?.projectId);
  const asked = gone.find((row) => row.slide !== undefined && !row.slide.confirmed);
  const missing =
    holders.placements.length > 0 || holders.births.length > 0
      ? "A Mate still works on this project. Delete it first."
      : holdings === undefined
        ? "Reading what HQ holds."
        : gone.length === 0
          ? "Nothing is set to go."
          : asked?.slide !== undefined
            ? asked.slide.missing
            : null;
  const names = Object.fromEntries(
    [
      ...project.placements,
      ...project.environments.flatMap((env) => (env.kind === "zerops" ? [env] : [])),
    ].flatMap(({ projectId, name }) => {
      const trimmed = name?.trim();
      return trimmed !== undefined && trimmed.length > 0 && trimmed.length <= 100
        ? [[projectId, trimmed]]
        : [];
    }),
  );
  const selected = (kind: DeletionRow["kind"]) =>
    gone.filter((row) => row.kind === kind).map((row) => row.id);
  const plains = selected("plain"),
    stages = selected("stage"),
    productions = selected("production");
  const keepRepos = partStays
    ? []
    : rows
        .filter((row) => row.kind === "code" && row.fate === "stays")
        .map((row) => row.id)
        .sort();
  const onlyMate =
    mate !== undefined && gone.length === 1 && gone[0]?.kind === "mate" && (partStays || codeStays);
  const start: DeletionStartBody | undefined =
    missing !== null
      ? undefined
      : onlyMate
        ? { kind: "start-mate-deletion", projectId: mate.projectId, keptGit: "keep" }
        : {
            kind: "start-app-deletion",
            appId: project.appId,
            stages,
            ...(mate === undefined ? {} : { mate: mate.projectId }),
            ...(plains.length === 0 ? {} : { plains }),
            ...(productions.length === 0 ? {} : { productions }),
            ...(keepRepos.length === 0 ? {} : { keepRepos }),
            ...(Object.keys(names).length === 0 ? {} : { names }),
          };
  return {
    rows,
    becomes,
    mateStaysParts,
    goes,
    stays,
    missing,
    ready: missing === null && deleteMateConfirmed(choice.projectName, project.name),
    start,
    submit: `Delete ${project.name}`,
  };
}

/** The warning for deleting a Production Mate made. */
export function productionDeletionWords(name: string) {
  return {
    warning: `Deleting Production ${name} takes it offline at once and can't be undone.`,
  };
}

/** One operation, from the review or a Mate's own dialog. */
export function deletionStart(input: {
  readonly orgId: string;
  readonly id: string;
  readonly offer: DeletionOffer;
  readonly review?: ReturnType<typeof deletionReview> | undefined;
}): (DeletionStartBody & { readonly orgId: string; readonly id: string }) | undefined {
  const { orgId, id, offer, review } = input;
  if (offer.kind === "standing") return undefined;
  if (offer.kind === "mate" || offer.kind === "last-mate-only")
    return {
      kind: "start-mate-deletion",
      orgId,
      id,
      projectId: offer.projectId,
      ...(offer.kind === "last-mate-only" ? { keptGit: "keep" as const } : {}),
    };
  return review?.ready && review.start !== undefined ? { ...review.start, orgId, id } : undefined;
}

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
      JSON.stringify(left.plains ?? []) === JSON.stringify(right.plains ?? []) &&
      JSON.stringify(left.productions ?? []) === JSON.stringify(right.productions ?? []) &&
      JSON.stringify(left.keepRepos ?? []) === JSON.stringify(right.keepRepos ?? [])
    );
  return false;
}

/** One part of HQ's deletion of the project, as its dialog lists it. */
export interface DeletionPart {
  readonly part: "mate" | "plain" | "stage" | "production" | "kept" | "code";
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
      case "plain":
        return [
          {
            part: "plain",
            label: named === undefined ? "A Zerops project" : `Zerops project ${named}`,
            state,
          },
        ];
      case "stage":
        return [
          { part: "stage", label: named === undefined ? "A Stage" : `Stage ${named}`, state },
        ];
      case "production":
      case "kept_production":
        return [
          {
            part: step.part === "production" ? "production" : "kept",
            label: named === undefined ? "A Production" : `Production ${named}`,
            state,
          },
        ];
      case "code":
        return [
          {
            part: "code",
            label: step.keeps?.length ? `Its code, keeping ${listed(step.keeps)}` : "Its code",
            state,
          },
        ];
      default:
        return [];
    }
  });
}

/** How one part's state reads in the deletion's list. */
export function partStateWords(part: DeletionPart): string {
  switch (part.state) {
    case "gone":
      return part.part === "kept" ? "Let go" : "Gone";
    case "deleting":
      return part.part === "kept" ? "Letting go" : "Deleting";
    case "pending":
      return "Waiting its turn";
    case "stopped":
      return "Stopped here";
    case "here":
      return "Still here";
  }
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
  readonly again: boolean;
  readonly who: string | null;
} {
  const parts = deletionParts(project);
  const at =
    parts.find((part) => part.state === "deleting" || part.state === "stopped") ??
    parts.find((part) => part.state === "pending");
  if (deletion.kind === "going")
    return {
      line:
        at === undefined
          ? "Deleting…"
          : `${at.part === "kept" ? "Letting go of" : "Deleting"} ${lowerFirst(at.label)}…`,
      failed: false,
      details: null,
      parts,
      again: false,
      who: null,
    };
  if (deletion.kind === "waiting")
    return {
      line: at === undefined ? "Deleting stopped" : `Deleting stopped at ${lowerFirst(at.label)}`,
      failed: false,
      details: null,
      parts,
      again: false,
      who: null,
    };
  const again = deletion.again === true;
  const gone = parts.filter((part) => part.state === "gone" && part.part !== "kept");
  const letGo = parts.filter((part) => part.state === "gone" && part.part === "kept");
  const standing = parts.filter((part) => part.state !== "gone");
  const goneLabel = (part: DeletionPart) =>
    part.part === "mate" ? `${lowerFirst(part.label)}'s workspace` : lowerFirst(part.label);
  return {
    line: [
      `${project.name} was not deleted · ${asSentence(operationFailureWords(deletion.failure))}`,
      ...(gone.length === 0 ? [] : [`Gone: ${listed(gone.map(goneLabel))}.`]),
      ...(letGo.length === 0
        ? []
        : [`Let go: ${listed(letGo.map((part) => lowerFirst(part.label)))}.`]),
      ...(standing.length === 0
        ? []
        : [`Still here: ${listed(standing.map((part) => lowerFirst(part.label)))}.`]),
    ].join(" "),
    failed: true,
    details: operationFailureDetails(deletion.failure),
    parts,
    again,
    who: again || project.deleteApp ? null : DELETE_PROJECT_WHO,
  };
}

/** Words for the deletion page. */
export function deletionPageWords(name: string) {
  return {
    title: `Delete ${name}`,
    line: "Nothing is deleted until you press Delete at the end.",
    running:
      "You can leave this page. HQ finishes the deletion, and every device shows how far it got.",
    runningTitle: `Deleting ${name}`,
    nothing: "Nothing in Zerops.",
    reading: "Reading the project from HQ…",
    gone: "This project is gone.",
    back: "Back",
    projects: "Projects",
    cancel: "Cancel",
    again: "Delete again",
    waitingFor: "waiting for",
    goes: "Goes",
    stays: "Stays",
    holdingsReading: "Reading what HQ holds",
  };
}
