/**
 * The import a release's plan runs before it deploys: the services production lacks, which a
 * person who may release can also run on their own from the review.
 */
import type { OperationEnd } from "@t3tools/client-runtime/data";
import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";
import { stringify } from "yaml";

const PREPROCESSOR = "#zeropsPreprocessor=on\n";

/**
 * The import YAML that creates the plan's services, as HQ runs it at the press (its `deltaImport`):
 * services only, each as the plan settles it, with the preprocessor line when a value is generated.
 * `undefined` when the plan creates nothing.
 */
export function servicePlanImportYaml(plan: ReleaseServicePlan): string | undefined {
  const services = plan.operations.flatMap((operation) =>
    operation.kind === "create" ? [operation.settings] : [],
  );
  if (services.length === 0) return undefined;
  const document = stringify({ services });
  return document.includes("<@") ? `${PREPROCESSOR}${document}` : document;
}

/** What the person is told of an import that did not finish; `null` once Zerops took it. */
export function importTrouble(end: NonNullable<OperationEnd>): string | null {
  switch (end.stage) {
    case "done":
      return end.outcome === "succeeded" ? null : "Zerops did not create them.";
    case "refused":
      return end.reason;
    case "unsent":
      return "Zerops did not take the import. Try again.";
    default:
      return "The import could not be followed. Check production's services before running it again.";
  }
}
