/**
 * What the New project page says — decided without React. The rest it shares with New Mate:
 * the Mate's name and face (`newMateSubmit`, `newMateFace`).
 */

/** A name as it will be called: its spaces collapsed, its ends trimmed. */
const called = (name: string) => name.replace(/\s+/g, " ").trim();

/**
 * What Create makes, by name, as Add a Mate's button names its Mate and project — "Create Acme
 * Shop with Vera" — and as much of it as is named while the names are still being typed.
 */
export function newProjectButton(input: {
  readonly projectName: string;
  readonly botName: string;
}): string {
  const project = called(input.projectName);
  const bot = called(input.botName);
  const what = project.length === 0 ? "a project" : project;
  return bot.length === 0 ? `Create ${what}` : `Create ${what} with ${bot}`;
}

/** The cities Zerops regions stand in, by the code a region's name ends with ("EU Central (prg1)"). */
const REGION_CITIES: Readonly<Record<string, string>> = {
  prg1: "Prague",
  ny1: "New York",
  sea1: "Seattle",
};

/**
 * A region as its tile says it: its name without the code, and the city it stands in where the
 * code names one we know (none for another: the tile says only what it knows).
 */
export function regionPlace(name: string): { readonly name: string; readonly city?: string } {
  const match = /^(.*?)\s*\(([^)]+)\)\s*$/u.exec(name);
  if (match === null) return { name };
  const city = REGION_CITIES[match[2]!.toLowerCase()];
  return city === undefined ? { name: match[1]! } : { name: match[1]!, city };
}
