import { RegistryContext } from "@effect/atom-react";
import {
  accountReadsAtom,
  acquireHqPressLease,
  birthAttempt,
  continueBirth,
  sharedBirthsAtom,
  type SharedBirth,
} from "@t3tools/client-runtime/data";
import { readMateFace } from "@t3tools/client-runtime/zerops";
import { RECIPE_REPO, RECIPE_TIER_PATHS } from "@t3tools/shared/hqRecipe";
import { useCallback, useContext, useMemo } from "react";
import { randomUUID } from "~/lib/utils";

import { accountHqApi, configuredHq } from "./accountHq";
import { invalidateZerops } from "./accountInvalidations";
import { captureAccountLifetime } from "./accountLifetime";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "./accountOperations";
import { continuedBirthPlan, type PinnedBirthRecipe } from "./continueBirth.logic";
import { pressPlatform, pressRegistration, runPress, type PressRegistration } from "./matePress";
import { pressStreamOf } from "./pressStreams";
import { useGitBrowseReads } from "./useGitBrowse";
import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { waitForBirthPlacement } from "./sharedBirths";

/** One account's birth actions; every decision is re-read from its shared projection at the write. */
export function useBirthActions(births: ReadonlyArray<SharedBirth>) {
  const { activeOrganization, client, user } = useZeropsSession();
  const operations = useAccountOperationsOptional();
  const registry = useContext(RegistryContext);
  const { organizationRef } = useZeropsData();
  const recipes = useMemo(
    () =>
      births.flatMap((birth) => {
        const recipe = birth.intent?.recipe;
        return birth.canContinue && recipe?.kind === "tier"
          ? [{ birthId: birth.id, appId: birth.appId, ...recipe }]
          : [];
      }),
    [births],
  );
  const { views } = useGitBrowseReads(
    recipes.map((recipe) => ({
      appId: recipe.appId,
      repo: RECIPE_REPO,
      read: "blob" as const,
      params: { sha: recipe.revision, path: RECIPE_TIER_PATHS[recipe.tier] },
    })),
    true,
  );

  const proceed = useCallback(
    async (birthId: string) => {
      if (activeOrganization === null || user === null || operations === null)
        return "unavailable" as const;
      const orgId = activeOrganization.id;
      const current = captureAccountLifetime();
      const read = () =>
        current() && registry.get(accountReadsAtom)?.orgId === orgId
          ? registry.get(sharedBirthsAtom(user.id)).open.find((birth) => birth.id === birthId)
          : undefined;
      const hq = configuredHq();
      const inputs = { client, operations, organizationId: orgId };
      const registration = (birth: SharedBirth): PressRegistration => {
        if (birth.intent === undefined)
          throw new Error("This birth's original plan is unavailable.");
        const face = readMateFace(birth.face);
        return {
          hq,
          groupId: birth.appId,
          kind: "mate",
          ...(birth.intent.placement.role === "stage" || birth.intent.placement.role === "devstage"
            ? { devstage: true as const }
            : {}),
          mate: {
            face:
              face?.tint === undefined || face.shape === undefined
                ? undefined
                : { tint: face.tint, shape: face.shape },
            ...(birth.intent.automated ? { automated: true as const } : {}),
          },
          standUp: birth.intent.standUp,
          intent: birth.id,
          ...(birth.chief === true ? { chief: true as const } : {}),
        };
      };
      const holdOf = (birth: SharedBirth) =>
        acquireHqPressLease(
          accountHqApi(client, orgId, hq),
          pressStreamOf(orgId),
          { kind: "mate", appId: birth.appId, active: current },
          randomUUID(),
        );
      const attach = async (birth: SharedBirth) => {
        const latest = read();
        if (
          latest === undefined ||
          !latest.canContinue ||
          latest.projectId !== birth.projectId ||
          latest.placement !== "unplaced" ||
          latest.projectId === null
        )
          throw new Error("The birth changed before its registration.");
        await pressRegistration(inputs, registration(latest))(latest.projectId);
      };
      return continueBirth({
        read,
        bind: async (birth, projectId) => {
          await operations.run(
            { kind: "bind-birth", orgId, appId: birth.appId, birthId: birth.id, projectId },
            { orgId, unobserved: HQ_UNFOLLOWED },
          );
        },
        attach,
        registerChief: async (birth) => {
          const latest = read();
          if (
            latest === undefined ||
            !latest.canContinue ||
            latest.id !== birth.id ||
            latest.progress.next.kind !== "register-chief"
          )
            throw new Error("The birth changed before its Chief registration.");
          await operations.run(
            { kind: "register-birth-chief", orgId, birthId: latest.id },
            { orgId, unobserved: HQ_UNFOLLOWED },
          );
        },
        waitForPlacement: (projectId, placement) =>
          waitForBirthPlacement(registry, sharedBirthsAtom(user.id), {
            birthId,
            projectId,
            placement,
            active: current,
          }),
        run: async (birth, from) => {
          const latest = read();
          if (
            latest === undefined ||
            !latest.canContinue ||
            latest.progress.next.kind !== from ||
            latest.projectId !== birth.projectId
          )
            throw new Error("The birth changed before it could continue.");
          const recipeIndex = recipes.findIndex(
            (entry) =>
              entry.birthId === latest.id &&
              latest.intent?.recipe.kind === "tier" &&
              entry.revision === latest.intent.recipe.revision &&
              entry.tier === latest.intent.recipe.tier,
          );
          const view = recipeIndex < 0 ? undefined : views[recipeIndex];
          const entry = recipeIndex < 0 ? undefined : recipes[recipeIndex];
          const recipe: PinnedBirthRecipe | undefined =
            entry !== undefined &&
            view?.state === "known" &&
            !view.answer.binary &&
            !view.answer.truncated &&
            view.answer.content !== null
              ? { revision: entry.revision, tier: entry.tier, yaml: view.answer.content }
              : undefined;
          const plan = continuedBirthPlan(latest, orgId, recipe);
          if (!plan.ok) throw new Error(plan.reason);
          if (from === "import" && (latest.projectId === null || latest.placement === "unknown"))
            throw new Error("The birth's registration is not current yet.");
          const platform = pressPlatform(inputs, {
            register:
              latest.placement === "attached"
                ? null
                : pressRegistration(inputs, registration(latest)),
            hq,
            untilServicesSettled: async () => [],
          });
          const outcome = await runPress({
            organizationId: orgId,
            steps: plan.steps,
            platform,
            birth: {
              id: latest.id,
              attempt: birthAttempt(operations.run, orgId, latest.id, current),
            },
            isCurrent: current,
            ...(from === "create" || latest.projectId === null
              ? {}
              : {
                  resume: {
                    from: latest.placement === "attached" ? 2 : 1,
                    projectId: latest.projectId,
                    projectName: latest.intent!.projectName,
                  },
                }),
            onProjectAccepted: async (projectId) => {
              if (!current()) return;
              invalidateZerops({ topic: "inventory", organization: organizationRef(orgId) });
              await operations.run(
                { kind: "bind-birth", orgId, appId: latest.appId, birthId: latest.id, projectId },
                { orgId, unobserved: HQ_UNFOLLOWED },
              );
            },
            hold: holdOf(latest),
          });
          if (!outcome.ok) throw new Error(outcome.error);
        },
        recordImport: async (birth, receipt) => {
          const latest = read();
          if (
            latest === undefined ||
            !latest.canContinue ||
            latest.projectId === null ||
            latest.projectId !== birth.projectId ||
            latest.progress.next.kind !== "record-import" ||
            latest.progress.next.receipt !== receipt
          )
            throw new Error("The birth changed before its import could be recorded.");
          const hold = holdOf(latest);
          try {
            if ((await hold.take(latest.projectId)) === "elsewhere")
              throw new Error("Its setup is already running in another browser.");
            if ((await hold.imported(receipt)) !== "recorded")
              throw new Error("HQ did not confirm the import receipt.");
          } finally {
            await hold.end(false);
          }
        },
      });
    },
    [activeOrganization, client, operations, organizationRef, recipes, registry, user, views],
  );

  const deleteUnbound = useCallback(
    async (birthId: string) => {
      if (activeOrganization === null || user === null || operations === null) return;
      const orgId = activeOrganization.id;
      const birth =
        registry.get(accountReadsAtom)?.orgId === orgId
          ? registry.get(sharedBirthsAtom(user.id)).open.find((entry) => entry.id === birthId)
          : undefined;
      if (birth === undefined || !birth.canDelete || birth.projectId !== null)
        throw new Error("The birth changed before it could be deleted.");
      await operations.run(
        { kind: "delete-birth", orgId, appId: birth.appId, birthId: birth.id },
        { orgId, unobserved: HQ_UNFOLLOWED },
      );
    },
    [activeOrganization, operations, registry, user],
  );
  return useMemo(() => ({ proceed, deleteUnbound }), [proceed, deleteUnbound]);
}
