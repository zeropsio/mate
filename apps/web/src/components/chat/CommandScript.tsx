import {
  commandHighlightLanguage,
  withVisibleControlCharacters,
} from "@t3tools/client-runtime/work-log/command-label";
import { Suspense, use, useEffect, useMemo, useState } from "react";

import { getSyntaxHighlighterPromise } from "../../lib/syntaxHighlighting";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { commandGrammars, grammarsReady } from "./commandScript.logic";
import { HighlightedTokens } from "./HighlightedTokens";
import { TimelineRowCtx } from "./timelineContext";

type EmbeddedScriptsModule = typeof import("../../lib/embeddedScripts");

// The shell parser loads with the first command shown, not with the timeline.
let embeddedScriptsModule: Promise<EmbeddedScriptsModule> | undefined;
let embeddedScriptsLoaded: EmbeddedScriptsModule | null = null;
function loadEmbeddedScripts() {
  embeddedScriptsModule ??= import("../../lib/embeddedScripts").then((module) => {
    embeddedScriptsLoaded = module;
    return module;
  });
  return embeddedScriptsModule;
}
/** Grammars whose highlighter has loaded, shared by every command. */
const loadedGrammars = new Set<string>();

function Highlighted({
  code,
  theme,
  embeddedScripts,
}: {
  code: string;
  theme: "light" | "dark";
  embeddedScripts: EmbeddedScriptsModule["embeddedScripts"];
}) {
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
 * and never suspends the conversation. Its colours turn on the grammars it
 * needs, not its text, so a command streaming in keeps them from one delta
 * to the next. A `bash -lc` script or a Python heredoc gets its own grammar.
 */
export function CommandScript({ script }: { script: string }) {
  // The conversation's theme, read from its rows' shared state rather than the window.
  const theme = use(TimelineRowCtx)?.resolvedTheme ?? "light";
  const code = withVisibleControlCharacters(script);
  const module = embeddedScriptsLoaded;
  const grammars = module === null ? null : commandGrammars(code, module.embeddedScripts);
  const ready = grammarsReady(grammars, loadedGrammars);
  const [, setLoads] = useState(0);
  const grammarsKey = grammars?.join(" ") ?? "";

  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadEmbeddedScripts()
      .then(({ embeddedScripts }) => {
        const needed = commandGrammars(code, embeddedScripts);
        return Promise.all(
          needed.map((grammar) =>
            getSyntaxHighlighterPromise(grammar).then(() => loadedGrammars.add(grammar)),
          ),
        );
      })
      .then(() => {
        if (live) setLoads((count) => count + 1);
      })
      // A grammar that cannot load leaves the plain code, which reads the same.
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Keyed on the grammars, not the code: a delta in the same grammars loads nothing.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, grammarsKey]);

  if (!ready || module === null) return code;
  return (
    <RenderErrorBoundary fallback={code}>
      <Suspense fallback={code}>
        <Highlighted code={code} theme={theme} embeddedScripts={module.embeddedScripts} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
