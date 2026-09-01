export const DISCONNECTED_COMPOSER_PLACEHOLDER =
  "Ask for changes, send follow-ups, or attach images";

export const DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER =
  "Ask anything, @tag files/folders, $use skills, or / for commands";

export const ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER = "Describe what you want to build or change…";

export function resolveConnectedComposerPlaceholder(input: {
  readonly zeropsAvailable: boolean;
}): string {
  return input.zeropsAvailable
    ? ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER
    : DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER;
}
