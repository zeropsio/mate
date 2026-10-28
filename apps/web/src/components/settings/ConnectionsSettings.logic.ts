/**
 * Settings › Environments: every shared environment of every application — production and each
 * stage — each named as it is everywhere else ("Shop · Production", "Shop · Client demo"), never
 * by the slug HQ made it under.
 *
 * Pure: the navigation's applications in, the rows out.
 */
import { environmentTitle } from "../zerops/place/place.logic";

export interface SharedEnvironmentRow {
  readonly appId: string;
  readonly environmentId: string;
  readonly tier: "production" | "stage";
  readonly title: string;
}

export function sharedEnvironmentRows(
  apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly environments?:
      | ReadonlyArray<{ readonly id: string; readonly tier: string; readonly name: string }>
      | { readonly refused: string }
      | undefined;
  }>,
): ReadonlyArray<SharedEnvironmentRow> {
  return apps.flatMap((app) => {
    if (app.environments === undefined || "refused" in app.environments) return [];
    const shared = app.environments.flatMap((environment) =>
      environment.tier === "production" || environment.tier === "stage"
        ? [
            {
              appId: app.id,
              environmentId: environment.id,
              tier: environment.tier,
              title: `${app.name} · ${environmentTitle(environment.tier, environment.name)}`,
            } satisfies SharedEnvironmentRow,
          ]
        : [],
    );
    return [
      ...shared.filter((row) => row.tier === "production"),
      ...shared.filter((row) => row.tier === "stage"),
    ];
  });
}
