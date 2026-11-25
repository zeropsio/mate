import { cn } from "../../lib/utils";
import { StepNumber } from "../ui/step-number";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  ADD_PROVIDER_WIZARD_STEPS,
  resolveWizardNavigation,
  type WizardNavigation,
} from "./AddProviderInstanceDialog.logic";

interface AddProviderInstanceWizardStepsProps {
  readonly currentStep: number;
  readonly summaries: readonly (string | null)[];
  readonly instanceIdError: string | null;
  readonly onNavigation: (navigation: WizardNavigation) => void;
}

export function AddProviderInstanceWizardSteps({
  currentStep,
  summaries,
  instanceIdError,
  onNavigation,
}: AddProviderInstanceWizardStepsProps) {
  return (
    // The steps on the segmented track: the current one pressed, each a way to its step.
    <ToggleGroup
      className="grid w-full grid-cols-3"
      render={<ol />}
      role="list"
      value={[String(currentStep)]}
    >
      {ADD_PROVIDER_WIZARD_STEPS.map((step, index) => (
        <li key={step} className="min-w-0">
          <Toggle
            size="default"
            className="w-full min-w-0 justify-start max-sm:justify-center"
            value={String(index)}
            aria-current={index === currentStep ? "step" : undefined}
            aria-label={`${step}, step ${index + 1}${index < currentStep && summaries[index] ? `, ${summaries[index]}` : ""}`}
            onClick={() =>
              onNavigation(
                resolveWizardNavigation(currentStep, index, ADD_PROVIDER_WIZARD_STEPS.length, {
                  instanceIdError,
                }),
              )
            }
          >
            <StepNumber
              n={index + 1}
              state={index < currentStep ? "done" : index === currentStep ? "current" : "todo"}
            />
            <span
              className={cn(
                "min-w-0 truncate text-body font-medium max-sm:hidden",
                index === currentStep ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step}
            </span>
          </Toggle>
        </li>
      ))}
    </ToggleGroup>
  );
}
