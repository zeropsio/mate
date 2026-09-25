import { createShadcnGuardRule, WEB_SOURCE_MARKER } from "../shadcnGuard.ts";

/**
 * Every class in web code must be one Tailwind generates: a typo or a class nothing declares
 * ships silently unstyled. JS hooks use data attributes, not class names. Upstream's
 * `shadcn/no-unknown-classes` behind the design-system exception ledger.
 */
export default createShadcnGuardRule({
  ruleName: "no-unknown-classes",
  innerRuleName: "no-unknown-classes",
  ledgerDirectoryEnv: "T3CODE_NO_UNKNOWN_CLASSES_LEDGER_DIRECTORY",
  options: {},
  inScope: (filename) => filename.includes(WEB_SOURCE_MARKER),
  description:
    "Every class in web code is one Tailwind generates or the CSS declares, with fingerprinted exceptions for existing call sites.",
});
