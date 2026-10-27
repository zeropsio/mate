import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ZeropsGitPage } from "../components/zerops/ZeropsGitPage";
import { resolveDoor } from "./-door";
import { loadDoorEnvironmentCount } from "./-doorEnvironments";

const GitSearch = Schema.Struct({
  appId: Schema.optionalKey(Schema.String),
  repo: Schema.optionalKey(Schema.String),
  rev: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.Literals(["tree", "file"])),
  /** The repository's page; absent, home, or code when `path` or `kind` is there. */
  view: Schema.optionalKey(
    Schema.Literals(["home", "code", "commits", "commit", "blame", "compare", "search"]),
  ),
  /** A line `L10` or a range `L10-L20` of a file. */
  lines: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^L\d+(-L\d+)?$/u))),
  base: Schema.optionalKey(Schema.String),
  head: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.Literals(["name", "content"])),
  mode: Schema.optionalKey(Schema.Literals(["fixed", "regex"])),
});
export type GitSearch = typeof GitSearch.Type;

const decodeGitSearch = Schema.decodeUnknownOption(GitSearch);

export const Route = createFileRoute("/git")({
  validateSearch: (search): typeof GitSearch.Type =>
    Option.getOrElse(decodeGitSearch(search), () => ({})),
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: await loadDoorEnvironmentCount(),
    });
    if (door.redirect !== null) {
      throw redirect({ to: door.redirect, replace: true });
    }
  },
  component: ZeropsGitPage,
});
