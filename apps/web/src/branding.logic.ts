const NIGHTLY_SERVER_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;

export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  if (input.stageLabel.trim().toLowerCase() === "latest") {
    return input.baseName;
  }

  return `${input.baseName} (${input.stageLabel})`;
}

/** A hosted channel's label: Latest or Nightly; none for any other channel. */
export function hostedChannelLabel(channel: string | undefined): "Latest" | "Nightly" | null {
  const normalized = channel?.trim().toLowerCase();
  return normalized === "nightly" ? "Nightly" : normalized === "latest" ? "Latest" : null;
}

/**
 * The tab's title a build gives before any server or desktop says otherwise: the boot shell's
 * (`index.html`, set at build) and the app's (`APP_DISPLAY_NAME`) the same, so the tab never
 * changes its name as the app starts.
 */
export function buildDocumentTitle(input: {
  readonly baseName: string;
  readonly channel: string | undefined;
  readonly dev: boolean;
}): string {
  return formatAppDisplayName({
    baseName: input.baseName,
    stageLabel: hostedChannelLabel(input.channel) ?? (input.dev ? "Dev" : "Alpha"),
  });
}

export function resolveServerBackedAppStageLabel(input: {
  readonly primaryServerVersion: string | null | undefined;
  readonly fallbackStageLabel: string;
}): string {
  return input.primaryServerVersion &&
    NIGHTLY_SERVER_VERSION_PATTERN.test(input.primaryServerVersion)
    ? "Nightly"
    : input.fallbackStageLabel;
}

export function resolveServerBackedAppDisplayName(input: {
  readonly baseName: string;
  readonly fallbackDisplayName: string;
  readonly fallbackStageLabel: string;
  readonly primaryServerVersion: string | null | undefined;
}): string {
  const stageLabel = resolveServerBackedAppStageLabel({
    primaryServerVersion: input.primaryServerVersion,
    fallbackStageLabel: input.fallbackStageLabel,
  });

  return stageLabel === input.fallbackStageLabel
    ? input.fallbackDisplayName
    : formatAppDisplayName({ baseName: input.baseName, stageLabel });
}
