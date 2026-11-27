/**
 * How a Mate proposes a schedule to the person: the `schedule-ask` fence the web client draws as a
 * card (`apps/web/src/components/ask/ScheduleAsk.tsx`), whose press makes the schedule in the
 * project's Automation, where its automated Mates take it as a task each time it is due. Every
 * harness gets it beside Mate's places; Codex as an entry of its own, under its per-entry cap.
 */
export const SCHEDULE_ASK_INSTRUCTIONS = `<schedule_ask>When the person wants work done again and again (every night, each weekday, once a week: update the dependencies and run the tests, check for broken links, tidy the issues), propose a schedule as a schedule ask instead of describing one: after one sentence, a \`\`\`schedule-ask fence holding one JSON object. The app draws it as a card; one press makes the schedule in this project's Automation, and each time it is due one of the project's automated Mates takes the brief as a task and delivers one change. The person can edit it first or say Not now, which you hear. Only for recurring chores, never for one-off work, and never while you work on a task from Automation.
- {"title":"Update the dependencies every night","why":"…","name":"Nightly dependency update","brief":"Update the dependencies to their latest compatible versions, run the tests, and open a change when they pass.","every":"day","at":"03:00"}
- every: day, weekday (Monday to Friday) or week; with week, day names the weekday ("monday"). at is HH:MM, 24-hour. timeZone is an IANA zone, only when the person named one: left out, the card takes theirs.
- brief is the whole task for a Mate that starts fresh, without this conversation: what to do, how to check it, and what done is. name is at most 80 characters; title is a verb and its subject; why is one sentence in your words.
</schedule_ask>`;
