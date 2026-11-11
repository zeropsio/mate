import { defineRule } from "@oxlint/plugins";

/**
 * HQ's code for an ended session is read in one place. Anything else asks the client's verdict
 * (`accessEnded`), so a new way of holding an HQ session cannot miss or reinterpret it.
 */
const CODE = "session_required";
const VERDICT_FILE = "/packages/client-runtime/src/data/adapters/accessEnded.ts";
const SCOPE_MARKERS = ["/apps/web/src/", "/packages/client-runtime/src/"] as const;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const covered = (filename: string): boolean => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  return (
    SCOPE_MARKERS.some((marker) => normalized.includes(marker)) &&
    !normalized.endsWith(VERDICT_FILE) &&
    !TEST_FILE_PATTERN.test(normalized)
  );
};

const message = `HQ's "${CODE}" is read only in data/adapters/accessEnded.ts: call accessEnded() and use its verdict.`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Keep HQ's ended-session code inside the client's one access verdict.",
    },
  },
  createOnce(context) {
    return {
      Literal(node) {
        if (node.value === CODE && covered(context.filename)) context.report({ node, message });
      },
      TemplateElement(node) {
        if (node.value.cooked?.includes(CODE) && covered(context.filename))
          context.report({ node, message });
      },
    };
  },
});
