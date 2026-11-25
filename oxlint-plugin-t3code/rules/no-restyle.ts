import { RADII } from "@t3tools/shared/brand";

import { createShadcnGuardRule, UI_SOURCE_MARKER, WEB_SOURCE_MARKER } from "../shadcnGuard.ts";

/**
 * `components/ui` exports own their look: app code picks a variant or size instead of restyling
 * one with `className`. Upstream's `shadcn/no-restyle` with the options upstream configures,
 * behind the design-system exception ledger (`exceptions/no-restyle.json`).
 */

/**
 * Layout classes (width, flex, margin, position) stay allowed because placement belongs to the
 * parent. Contracts widen that per component where the className is the component's API.
 */
export const NO_RESTYLE_OPTIONS = {
  allow: ["layout"],
  contracts: [
    {
      // CollapsibleTrigger is a bare button with no styled counterpart (a disclosure row is not
      // a Button), so its className is the API. Every other trigger has one: style them with
      // render={<Button …/>}.
      pattern: "^CollapsibleTrigger$",
      allow: ["layout", "color", "typography", "spacing", "shape", "effects", "motion"],
    },
  ],
};

/**
 * The scale's corners (`rounded-control`, `rounded-t-card`, …). Upstream's grammar reads
 * tailwind-merge's defaults, which do not name them, so it calls them unclassified; they are shape.
 */
const SCALE_RADIUS = new RegExp(
  `^(?:[^:]+:)*rounded(?:-(?:s|e|t|r|b|l|ss|se|es|ee|tl|tr|br|bl))?-(?:${Object.keys(RADII).join("|")})$`,
  "u",
);

const allowsShape = (component: string): boolean =>
  NO_RESTYLE_OPTIONS.contracts.some(
    (contract) =>
      new RegExp(contract.pattern, "u").test(component) && contract.allow.includes("shape"),
  );

export default createShadcnGuardRule({
  ruleName: "no-restyle",
  innerRuleName: "no-restyle",
  ledgerDirectoryEnv: "T3CODE_NO_RESTYLE_LEDGER_DIRECTORY",
  options: NO_RESTYLE_OPTIONS,
  accepts: (data) =>
    data.category === "unclassified" &&
    SCALE_RADIUS.test(String(data.className)) &&
    allowsShape(String(data.component)),
  inScope: (filename) =>
    filename.includes(WEB_SOURCE_MARKER) && !filename.includes(UI_SOURCE_MARKER),
  description:
    "components/ui exports own their look: pick a variant or size instead of restyling with className, with fingerprinted exceptions for existing call sites.",
});
