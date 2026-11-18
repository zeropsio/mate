import { defineRule } from "@oxlint/plugins";

import {
  ADMIT_RUN_CALLERS,
  ENGINE_DIR,
  ENGINE_PORTS_FILE,
  ENGINE_RUN_ADMISSION_SITE,
} from "../engineBoundary.ts";

/**
 * Every engine run is admitted once (`oxlint-plugin-t3code/engineBoundary.ts`): in a non-test
 * server module, a call of a member named `admitRun` outside `ADMIT_RUN_CALLERS` is reported, and
 * in the engine an import of `RunAdmission` outside `ENGINE_RUN_ADMISSION_SITE` (the port's own
 * `ports.ts` excepted).
 */
const SCOPE_MARKER = "/apps/server/src/";
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const ADMIT_RUN_MESSAGE =
  "ZeropsTurnAdmission.admitRun is the engine's run door: only the files in ADMIT_RUN_CALLERS call it (oxlint-plugin-t3code/engineBoundary.ts).";
const RUN_ADMISSION_MESSAGE =
  "The Mate engine admits its runs in one place: only ENGINE_RUN_ADMISSION_SITE asks RunAdmission (oxlint-plugin-t3code/engineBoundary.ts).";

/** The repo-relative path of a covered module, or undefined outside the scope. */
const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return TEST_FILE_PATTERN.test(path) ? undefined : path;
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Only the listed callers call admitRun; the engine asks RunAdmission once.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    const callsAllowed = ADMIT_RUN_CALLERS[path] !== undefined;
    const asksChecked =
      path.startsWith(`${ENGINE_DIR}/`) &&
      path !== ENGINE_PORTS_FILE &&
      path !== ENGINE_RUN_ADMISSION_SITE;

    return {
      CallExpression: (node) => {
        if (callsAllowed) return;
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier" &&
          callee.property.name === "admitRun"
        ) {
          context.report({ node, message: ADMIT_RUN_MESSAGE });
        }
      },
      ImportDeclaration: (node) => {
        if (!asksChecked) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "RunAdmission"
          ) {
            context.report({ node: specifier, message: RUN_ADMISSION_MESSAGE });
          }
        }
      },
    };
  },
});
