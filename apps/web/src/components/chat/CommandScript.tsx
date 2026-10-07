import {
  commandHighlightLanguage,
  withVisibleControlCharacters,
} from "@t3tools/client-runtime/work-log/command-label";
import { Suspense, use, useEffect, useMemo, useState } from "react";

import { getSyntaxHighlighterPromise } from "../../lib/syntaxHighlighting";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { HighlightedTokens } from "./HighlightedTokens";
import { TimelineRowCtx } from "./timelineContext";

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
 * hues mixed into it, never louder than the plain code. It first paints as
 * the plain code, the same text, so it wraps, cuts and selects exactly as
 * before the grammar arrives; the grammar loads after the row has painted
 * and never suspends the conversation. A `bash -lc` script or a Python
 * heredoc gets its own grammar.
 */
export function CommandScript({ script }: { script: string }) {
  // The conversation's theme, read from its rows' shared state rather than the window.
  const theme = use(TimelineRowCtx)?.resolvedTheme ?? "light";
  const code = withVisibleControlCharacters(script);
  const [ready, setReady] = useState<string | null>(null);
  const key = `${theme}\n${code}`;

  useEffect(() => {
    let live = true;
    const language = commandHighlightLanguage(code);
    void loadEmbeddedScripts()
      .then(({ embeddedScripts }) =>
        Promise.all([
          getSyntaxHighlighterPromise(language),
          ...(language === "shellscript"
            ? embeddedScripts(code).map((embedded) =>
                getSyntaxHighlighterPromise(embedded.language),
              )
            : []),
        ]),
      )
      .then(() => {
        if (live) setReady(key);
      })
      // A grammar that cannot load leaves the plain code, which reads the same.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code, key]);

  if (ready !== key) return code;
  return (
    <RenderErrorBoundary fallback={code}>
      <Suspense fallback={code}>
        <Highlighted code={code} theme={theme} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
