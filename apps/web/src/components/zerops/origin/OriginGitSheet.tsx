/**
 * The Git sheet an origin ask opens: production on `main` first, prefilled with the asked address
 * and the HQ repository the Mate will wire — production adopts the origin's files and history —
 * then, in the same sheet, stage on its default branch, read again for its own review.
 */
import { GitProductionSheet } from "../GitProductionSheet";
import type { GitEnvironmentFormInputs } from "~/zerops/useGitEnvironmentFormInputs";
import { originAddress } from "./originAsk.logic";

export interface OriginGitSheetProps {
  readonly url: string;
  readonly repo: string;
  readonly groupName: string;
  readonly git: GitEnvironmentFormInputs;
  /** Production is added: a Git environment for the asked repository exists. */
  readonly onConnected: () => void;
  readonly onClose: () => void;
}

export function OriginGitSheet({
  url,
  repo,
  groupName,
  git,
  onConnected,
  onClose,
}: OriginGitSheetProps) {
  return (
    <GitProductionSheet
      {...git}
      defaultName={`${groupName} - production`}
      groupName={groupName}
      onAdded={onClose}
      onCancel={onClose}
      onProductionAdded={onConnected}
      prefill={{ address: originAddress(url), repo }}
      stageNext
    />
  );
}
