/**
 * The import a release's plan runs before it deploys: the services production lacks, which a
 * person who may release can also create on their own, early, from the review's step or a Mate's
 * ask.
 */
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
