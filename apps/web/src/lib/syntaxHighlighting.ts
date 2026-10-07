import type { DiffsHighlighter, SupportedLanguages } from "@pierre/diffs";

import { resolveDiffThemeName } from "./diffPresentation";

let runtimePromise: Promise<typeof import("./syntaxHighlightingRuntime")> | undefined;

export function getSyntaxRuntimePromise() {
  runtimePromise ??= import("./syntaxHighlightingRuntime").catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

export function getSyntaxHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSyntaxRuntimePromise()
    .then(({ getSharedHighlighter }) =>
      getSharedHighlighter({
        themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
        langs: [language as SupportedLanguages],
        preferredHighlighter: "shiki-js",
      }),
    )
    .catch((error) => {
      if (language === "text") {
        highlighterPromiseCache.delete(language);
        // "text" itself failed — Shiki cannot initialize at all, surface the error
        throw error;
      }
      // Language not supported by Shiki — fall back to "text"
      return getSyntaxHighlighterPromise("text");
    });
  highlighterPromiseCache.set(language, promise);
  return promise;
}
