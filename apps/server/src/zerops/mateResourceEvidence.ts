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
        const average = (name: string) => {
          const text = values[name];
          if (text === undefined) return undefined;
          const value = Number(text);
          if (text === "" || !Number.isFinite(value) || value < 0 || value > 100)
            throw new Error("Invalid PSI");
          return value;
        };
        const avg10 = average("avg10");
        const avg60 = average("avg60");
        const avg300 = average("avg300");
        if (avg10 === undefined || values.total === undefined) throw new Error("Invalid PSI");
        return [
          kind,
          {
            avg10,
            ...(avg60 === undefined ? {} : { avg60 }),
            ...(avg300 === undefined ? {} : { avg300 }),
            total: numberOf(values.total),
          },
        ] as const;
      }),
  );
  const some = lines.get("some");
  if (some === undefined) throw new Error("Missing PSI some");
  return { some, full: lines.get("full") ?? null };
}
