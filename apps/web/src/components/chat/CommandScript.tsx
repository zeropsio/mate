import {
  commandHighlightLanguage,
  withVisibleControlCharacters,
} from "@t3tools/client-runtime/work-log/command-label";
import { Suspense, use, useMemo } from "react";

import { useTheme } from "../../hooks/useTheme";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { HighlightedTokens } from "./HighlightedTokens";

// The shell parser loads with the first command shown, not with the timeline.
let embeddedScriptsModule: Promise<typeof import("../../lib/embeddedScripts")> | undefined;
function loadEmbeddedScripts() {
  embeddedScriptsModule ??= import("../../lib/embeddedScripts");
  return embeddedScriptsModule;
}

function Highlighted({ code, theme }: { code: string; theme: "light" | "dark" }) {
  const { embeddedScripts } = use(loadEmbeddedScripts());
  const language = commandHighlightLanguage(code);
  // Only shell syntax nests scripts; PowerShell's own grammar colors its strings.
  const embedded = useMemo(
    () => (language === "shellscript" ? embeddedScripts(code) : []),
    [code, embeddedScripts, language],
  );
  return (
    <HighlightedTokens code={code} language={language} embedded={embedded} theme={theme} muted />
  );
}

/**
 * A command's code, syntax highlighted in its box's muted ink: the grammar's
 * hues mixed into it, never louder than the plain code. The text is the plain
 * code's own, so it wraps, cuts and selects exactly as before the grammar
 * arrives; a `bash -lc` script or a Python heredoc gets its own grammar.
 */
export function CommandScript({ script }: { script: string }) {
  const { resolvedTheme } = useTheme();
  const code = withVisibleControlCharacters(script);
  return (
    <RenderErrorBoundary fallback={code}>
      <Suspense fallback={code}>
        <Highlighted code={code} theme={resolvedTheme} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
