/**
 * `GET /project/{id}/env-file` answers `{ envFile }`: one `KEY="value"` line per variable, with `\`
 * escaping `"`, `\` and `$` inside the quotes (measured 2026-10-02). The file does not say which
 * variables are sensitive: for a Read only credential their value is the literal `REDACTED`.
 *
 * @module zerops/envFile
 */
const LINE = /^([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"$/u;

const UNESCAPED: Readonly<Record<string, string>> = { n: "\n", r: "\r", t: "\t" };

export const parseEnvFile = (envFile: string): ReadonlyMap<string, string> =>
  new Map(
    envFile.split("\n").flatMap((line) => {
      const match = LINE.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) return [];
      return [
        [match[1], match[2].replace(/\\(.)/gu, (_, char: string) => UNESCAPED[char] ?? char)],
      ];
    }),
  );
