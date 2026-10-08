import type { ResourcePressure } from "@t3tools/contracts";

export const numberOf = (text: string): number => {
  if (!/^\d+$/.test(text.trim())) throw new Error("Invalid kernel counter");
  const value = Number(text.trim());
  if (!Number.isSafeInteger(value)) throw new Error("Kernel counter exceeds wire precision");
  return value;
};
export const limitOf = (text: string) => (text.trim() === "max" ? null : numberOf(text));
export function pressureOf(text: string): ResourcePressure {
  const lines = new Map(
    text
      .trim()
      .split("\n")
      .map((line) => {
        const [kind, ...fields] = line.split(/\s+/);
        const values = Object.fromEntries(fields.map((field) => field.split("=")));
        const avg10 = Number(values.avg10);
        if (!Number.isFinite(avg10) || avg10 < 0 || avg10 > 100 || values.total === undefined)
          throw new Error("Invalid PSI");
        return [kind, { avg10, total: numberOf(values.total) }] as const;
      }),
  );
  const some = lines.get("some");
  if (some === undefined) throw new Error("Missing PSI some");
  return { some, full: lines.get("full") ?? null };
}
