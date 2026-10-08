import { commandHighlightLanguage } from "@t3tools/client-runtime/work-log/command-label";

/**
 * The grammars a command's colours need: its own, then each embedded
 * script's. Only shell syntax nests scripts; PowerShell's own grammar colours
 * its strings.
 */
export function commandGrammars(
  code: string,
  embeddedScripts: (code: string) => ReadonlyArray<{ readonly language: string }>,
): readonly string[] {
  const language = commandHighlightLanguage(code);
  if (language !== "shellscript") return [language];
  return [...new Set([language, ...embeddedScripts(code).map((script) => script.language)])];
}

/**
 * Whether a command can paint its colours now. It turns on the grammars
 * alone, not the code, so a command that streams in keeps its colours from
 * one delta to the next.
 */
export function grammarsReady(
  grammars: readonly string[] | null,
  loaded: ReadonlySet<string>,
): boolean {
  return grammars !== null && grammars.every((grammar) => loaded.has(grammar));
}
