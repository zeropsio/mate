import * as Effect from "effect/Effect";

/** Render a command using the executable installed from the current release tarball. */
export const formatCliCommand = (subcommand: string): string => `mate ${subcommand}`;

export const resolveCliCommand = (subcommand: string) =>
  Effect.succeed(formatCliCommand(subcommand));
