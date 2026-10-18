/**
 * A Git production, then stage in the same sheet on the repository production was added on, read
 * again for its own review: the order every way of adding a Git production takes, where the
 * application can still take a stage.
 */
import { useState } from "react";

import { GitEnvironmentForm, type GitEnvironmentFormProps } from "./GitEnvironmentForm";

export interface GitProductionSheetProps extends Omit<GitEnvironmentFormProps, "tier" | "onAdded"> {
  /** Whether stage follows once production is added: the application takes one. */
  readonly stageNext: boolean;
  /** Production is added. */
  readonly onProductionAdded?: (() => void) | undefined;
  /** The sheet is done: production added and, where offered, stage. */
  readonly onAdded: () => void;
}

export function GitProductionSheet({
  stageNext,
  onProductionAdded,
  onAdded,
  onBack,
  ...form
}: GitProductionSheetProps) {
  const [production, setProduction] = useState<{
    readonly address: string;
    readonly repo: string;
  }>();
  return production === undefined ? (
    <GitEnvironmentForm
      {...form}
      {...(onBack === undefined ? {} : { onBack })}
      key="production"
      onAdded={(_name, repository) => {
        onProductionAdded?.();
        if (stageNext) setProduction(repository);
        else onAdded();
      }}
      tier="production"
    />
  ) : (
    <GitEnvironmentForm
      {...form}
      defaultName={`${form.groupName} - stage`}
      key="stage"
      onAdded={onAdded}
      prefill={{ ...production, atBranch: true }}
      tier="stage"
    />
  );
}
