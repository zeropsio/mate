import { defineRule, type ESTree } from "@oxlint/plugins";

import { isEngineOwnerSeam, UPDATE_NEUTRAL_SEAMS } from "../engineBoundary.ts";

/**
 * The crew module's two boundaries. Crew mode lives in `apps/server/src/zerops/crew/**`: only the
 * wiring files reach into it — ws.ts spreads its RPCs, the feeds layer composes it, the fixture
 * layer gives fixtures its inert form — and it reaches out only to the services named below.
 * Never `provider/**`: a crewmate's thread is shaped through the SPI files, not by importing a
 * driver. Tests may reach further (the database, the ssh shim, the membership watch's subject
 * prefix). Every import, re-export and dynamic import with a relative source in a non-test server
 * module, type-only ones included, is resolved to its repo path and judged by these lists, exactly
 * as written (the lists name `.ts` files). A list entry is added in review, never by a
 * suppression comment.
 */
const SERVER_SOURCE = "apps/server/src/";
const SCOPE_MARKER = `/${SERVER_SOURCE}`;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const CREW_DIR = "apps/server/src/zerops/crew";
const CREW_WIRING_FILES: ReadonlySet<string> = new Set([
  // The engine's workspace port, which reads a crewmate's workspace off the crew's directory.
  "apps/server/src/zerops/engineAdapters.ts",
  "apps/server/src/zerops/mateUpdateDrainLive.ts",
  "apps/server/src/ws.ts",
  "apps/server/src/zerops/zeropsFeedsLayer.ts",
  "apps/server/src/zerops/ZeropsFixtureFeeds.ts",
]);
const CREW_ALLOWED_OUTSIDE: ReadonlySet<string> = new Set([
  ...UPDATE_NEUTRAL_SEAMS,
  "apps/server/src/config.ts",
  "apps/server/src/processRunner.ts",
  "apps/server/src/orchestration/Services/MessageAttachments.ts",
  "apps/server/src/spi/claudeThreadProfile.ts",
  "apps/server/src/spi/providerInstances.ts",
  "apps/server/src/spi/threadToolPolicy.ts",
  "apps/server/src/zerops/ZeropsAgentAuth.ts",
  "apps/server/src/zerops/ZeropsCli.ts",
  "apps/server/src/zerops/ZeropsEnvironment.ts",
  "apps/server/src/zerops/ZeropsLogins.ts",
  "apps/server/src/zerops/ZeropsRepositorySource.ts",
  "apps/server/src/zerops/ZeropsTurnAdmission.ts",
  "apps/server/src/zerops/ZeropsWorkspaceAccess.ts",
  "apps/server/src/zerops/ZeropsWorkspaceObserver.ts",
  "apps/server/src/zerops/registerZeropsRpc.ts",
]);

const SUMMARY =
  "This import crosses the crew module's boundary: only the wiring files reach into zerops/crew, and crew reaches only its named services (oxlint-plugin-t3code/rules/crew-boundary.ts).";

/** The repo-relative path of a covered module, or undefined outside the scope. */
const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/** Joins segments onto a base, applying `.` and `..` as a POSIX path would. */
const joinSegments = (base: ReadonlyArray<string>, relative: string): string => {
  const segments = [...base];
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
};

const inCrew = (path: string) => path.startsWith(`${CREW_DIR}/`);

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Only the wiring files reach into the crew module; crew reaches only its named services.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    const directory = path.split("/").slice(0, -1);
    const insideCrew = inCrew(path);

    const check = (node: ESTree.Node, source: ESTree.Node | null | undefined) => {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      if (!source.value.startsWith(".")) return;
      const target = joinSegments(directory, source.value);
      const targetInCrew = inCrew(target);
      const allowed = insideCrew
        ? targetInCrew || CREW_ALLOWED_OUTSIDE.has(target) || isEngineOwnerSeam(path, target)
        : !targetInCrew || CREW_WIRING_FILES.has(path);
      if (allowed) return;
      context.report({ node, message: SUMMARY });
    };

    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
    };
  },
});
