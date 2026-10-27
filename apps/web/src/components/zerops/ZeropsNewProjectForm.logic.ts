/**
 * What the New project dialog says — decided without React. The rest it shares with New Mate:
 * the Mate's name and face (`newMateSubmit`, `newMateFace`) and what happens next
 * (`newProjectNext`).
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
