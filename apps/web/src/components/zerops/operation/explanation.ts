/**
 * Which lines of a failed card's log tail (`ZeropsOperation.explanation`)
 * read as errors. The tail is raw build/runtime output with no severity of
 * its own, so a line is toned by the words build tools use to say it failed.
 * Pure, props only (R2).
 */
const ERROR_WORD = /\b(?:err|error|fatal|failed|exception|panic)\b/i;

export function isErrorLogLine(line: string): boolean {
  return ERROR_WORD.test(line);
}
