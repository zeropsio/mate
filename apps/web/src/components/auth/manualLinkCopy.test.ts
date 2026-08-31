// @effect-diagnostics nodeBuiltinImport:off -- This regression test inspects the source boundary.
import * as NodeFS from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { LEGACY_VOCABULARY_PATTERNS } from "@t3tools/shared/legacyVocabulary";

import { PairingPendingSurface } from "./PairingRouteSurface";
import { MANUAL_LINK_COPY } from "./manualLinkCopy";

const JSX_OPENING_TAG_PATTERN = /<[A-Za-z][^<>]*>/gu;
const TECHNICAL_PAIRING_ATTRIBUTE_PATTERN =
  /\b(htmlFor|id)\s*=\s*(?:\{\s*["']pairing-token["']\s*\}|["']pairing-token["'])/gu;

const containsLegacyVocabulary = (source: string): boolean =>
  LEGACY_VOCABULARY_PATTERNS.some(({ pattern }) => pattern.test(source));

const removeTechnicalPairingTerms = (source: string): string =>
  source
    .replace(JSX_OPENING_TAG_PATTERN, (openingTag) =>
      openingTag.replace(TECHNICAL_PAIRING_ATTRIBUTE_PATTERN, '$1=""'),
    )
    .replace('"pairing" | "paired" | "error"', "")
    .replace('? "pairing" : "error"', "")
    .replace('setStatus("pairing")', "")
    .replace('status === "pairing"', "");

describe("manual one-time-link copy", () => {
  it("keeps legacy copy literals out of the rendering module", () => {
    const source = removeTechnicalPairingTerms(
      NodeFS.readFileSync(new URL("./PairingRouteSurface.tsx", import.meta.url), "utf8"),
    );

    expect(containsLegacyVocabulary(source)).toBe(false);
  });

  it("does not hide pairing-token when it is visible copy", () => {
    const source = removeTechnicalPairingTerms('const view = <p>{"pairing-token"}</p>;');

    expect(containsLegacyVocabulary(source)).toBe(true);
  });

  it("does not hide attribute-shaped pairing-token visible text", () => {
    const source = removeTechnicalPairingTerms('<p>id="pairing-token"</p>');

    expect(containsLegacyVocabulary(source)).toBe(true);
  });

  it("masks pairing-token only in JSX id and htmlFor attributes", () => {
    const source = removeTechnicalPairingTerms(
      `<label htmlFor={"pairing-token"}><input id='pairing-token' /></label>`,
    );

    expect(containsLegacyVocabulary(source)).toBe(false);
  });

  it("keeps the pending heading wording unchanged", () => {
    const markup = renderToStaticMarkup(createElement(PairingPendingSurface));

    expect(markup).toContain("Pairing with this environment");
  });

  it("explains an empty authentication gate", () => {
    expect(MANUAL_LINK_COPY.describeAuthGate([])).toBe(
      "This environment offers no sign-in from here; ask an operator for a one-time link.",
    );
  });

  it("explains an empty supported-method set", () => {
    expect(MANUAL_LINK_COPY.describeSupportedMethods([])).toBe(
      "This environment offers no sign-in from here; ask an operator for a one-time link.",
    );
  });
});
