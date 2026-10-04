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
});

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
