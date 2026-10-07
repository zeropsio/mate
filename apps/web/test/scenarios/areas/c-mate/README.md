# Chat wire journeys

Run `node scripts/chat-gate.ts` for provider goldens, these client journeys and the
wire consumers' typechecks. C runs the hosted web bundle against real disposable HQ
and git services, with authored Mate/provider/platform wire facts. It never runs a
provider or accesses a real Zerops account. Desktop uses this web implementation;
mobile keeps its existing path and is not certified by these browser journeys.

`chat.scenario.ts` owns J01 (entry/return) and J02 (send, ownership and answers).
The eight additional cases are J03/J05/J09 in `composer.scenario.ts`, J04/J08 in
`replay.scenario.ts`, and J06/J07/J10 in `results.scenario.ts`. Lifecycle admission
cases live beside J02 and are retained separately.

Drivers supply schema-checked snapshots, events, receipts, bytes and explicit
refusals. Assertions inspect visible words, accessible controls, destinations and
the requests resulting from a person's actions. Opening durations are diagnostic;
neither elapsed-time ratios nor private stores/reducer decisions determine success.

| Behaviour | Journey               | Observable proof                                                                                                                                      |
| --------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z01       | J01                   | Cold door, direct thread/project links, named header, history, return and reload.                                                                     |
| Z02       | J02 + lifecycle cases | Owner sends; colleague reads without send/approve; unrecorded/refused/offboarded intent stays recoverable; revoked content leaves.                    |
| Z03       | J03                   | Sign-in and Cancel remain available for a locked agent; ready locked agent cannot be chosen.                                                          |
| Z04       | J03                   | First effort is named; High is requested and remains selected after reload.                                                                           |
| Z05       | J03                   | Stand-up holds the empty composer; reported start makes it usable; bootstrap text is not a new authored message.                                      |
| Z06       | J05                   | Selected table schema travels with the originating draft after a late reply while another Mate is open.                                               |
| Z07       | J09                   | Chips contain keys, dismissal excludes one, refusal retains them, accepted context clears included keys, later keys do not enter queued instructions. |
| Z08       | J09                   | Missing-key request survives folded work/reload; refusal remains answerable; accepted save settles it without exposing the secret.                    |
| Z09       | J09                   | Landed change enters agent notes while durable text remains exact; compact excludes context and the next message can carry it.                        |
| Z10       | J10                   | Busy main cannot be archived; main stays first without message-driven reshuffling; replacement main and crew return stay reachable.                   |
| Z11       | J10                   | Selected handle routes Tell/message to Scout; task opens its report/brief; job seam appears once.                                                     |
| Z12       | J04/J06               | Reading, work expansion, live settlement and reload preserve distinct messages and outputs.                                                           |
| Z13       | J06 + A               | Helper retains its name/work; concurrent calls have their own outputs; unreturned call says No result. A protects provider attribution.               |
| Z14       | J07 + A               | One crash explanation retains partial work; follow-up succeeds; Stop has a stopped outcome. A protects typed terminal events.                         |
| Z15       | J08 + A               | Usage pause holds work; resume switch works both ways and survives reload; source resumption releases the question.                                   |
| Z16       | J06                   | Failed and retried deploy remain distinguishable; reported platform build still says Deploying after the turn finishes.                               |
| Z17       | J06 + A               | Native and MCP results can be opened, read/copied and closed; missing output differs from returned output/refusal.                                    |
| Z18       | J06/J07 + A           | An earlier write shows its recorded content despite a later edit; selected run diff contains its captured change.                                     |
| Z19       | J06 + A               | Screenshot opens for matching call/turn; wrong-turn evidence is absent; partial omission retains it; complete empty removes it.                       |
| Z20       | J05                   | Crop/note/undo use real gestures; refusal retains pictures; accepted send records selected order and edited notes.                                    |
| Z21       | J05/J06               | Image-only message survives reload; unavailable bytes show an explanation; a recorded screenshot opens in its viewer.                                 |
| Z22       | J07                   | Eligible fix fills appdev/log context without sending; diff request names the originating thread/run/root.                                            |
| Z23       | J02/J08               | Option sends intended value; custom text/image stays with its question through refusal/reload; another owner's approval is read-only.                 |
| Z24       | J04                   | HTTP history is usable before readiness; duplicate replay stays singular; reverted late page cannot resurrect removed rows.                           |
| Z25       | J04/J06               | Streaming allows draft typing, reading and copying; parked return includes newer content.                                                             |
| Z26       | J04/J08               | Older reading anchor/draft survive arriving work; sign-out hides previous account's late messages/browser evidence.                                   |
| Z27       | J07                   | Partial checkpoint lists both roots, successful diff remains, refused rewind names the missing root/retry and retains work.                           |
| Z28       | J07/J10               | Container UI offers no pairing/local worktree; rewind explicitly keeps workspace files; permitted crew chat remains reachable.                        |
| Z29       | J06 + A               | Whole-name MCP output remains understandable; A certifies canonical tool inputs/results and envelope carriers for every provider.                     |
| Z30       | J10                   | Scout's agent/effort are visible; read-only denial retains instruction without an invented approval.                                                  |
| Z31       | J10                   | Ordinary MCP toggle names its server/thread; crew conversation and denial remain independently available.                                             |
| Z32       | J03                   | Wire model names/effort are visible; empty/incompatible catalog explains setup and disables send.                                                     |
| Z33       | J03/J06 + A           | Setup error names Zerops Mate/container; reported ordinary tools complete without an approval request.                                                |
| Z34       | J03/J04/J09/J10       | Stand-up, landing, compact and crew seam remain readable once beside authored conversation text.                                                      |
| Z35       | J08                   | New source epoch survives older relay evidence; owner reading clears only their unread result; a new main with unchanged counts stays reachable.      |

These are client contract proofs. Actual provider permission enforcement, git
restore preservation, CLI compatibility probing and platform deployment execution
belong to their server/provider integration tests; a browser fixture does not prove
those side effects happened.
