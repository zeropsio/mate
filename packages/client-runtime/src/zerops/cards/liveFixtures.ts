/**
 * Verbatim `zerops_*` tool results captured from a live container.
 *
 * Project `z3-eval` via the z3 server on `zcp-26a7`, 2026-08-28, against the
 * unadopted service `s3git1`. Kept byte-exact on purpose — a fixture rewritten
 * by hand stops being evidence, and these are the only samples proving the
 * decoders read what zcp actually emits rather than what its Go structs
 * suggested.
 */

/** `zerops_verify hostname="s3git1"` — a healthy runtime, two passing checks. */
export const LIVE_VERIFY_RESULT =
  '{"hostname":"s3git1","type":"runtime","typeVersion":"ubuntu/nodejs@22","runtimeClass":"worker","status":"healthy","checks":[{"name":"service_running","status":"pass"},{"name":"error_logs","status":"pass"}],"workSessionState":{"status":"none","note":"No active develop session \u2014 deploy not tracked. Start one via zerops_workflow action=\\"start\\" workflow=\\"develop\\" intent=\\"...\\" scope=[...] to pick up auto-close + verify tracking."},"envelope":{"phase":"idle","environment":"container","idleScenario":"adopt","selfService":{"hostname":"zcp"},"project":{"id":"nTV3oMB2SS634ImDJnQckg","name":"z3-eval"},"services":[{"hostname":"s3git1","typeVersion":"ubuntu/nodejs@22","runtimeClass":"dynamic","status":"ACTIVE","bootstrapped":false},{"hostname":"s3git2","typeVersion":"ubuntu/nodejs@22","runtimeClass":"dynamic","status":"ACTIVE","bootstrapped":false}],"generated":"2026-08-28T17:28:27.758010723Z"}}';

/**
 * `zerops_deploy hostname="s3git1"` on a service with no zerops.yaml.
 *
 * Not the ADOPT_REQUIRED refusal that was expected: zcp got past the adopt gate
 * and failed in the SSH deploy itself. That makes it the better sample — it is
 * a real `ErrorWire` with a multi-line `error`, a `diagnostic`, a `recovery`
 * and a `failureClassification`.
 */
export const LIVE_DEPLOY_ERROR_RESULT =
  '{"code":"SSH_DEPLOY_FAILED","error":"SSH deploy from s3git1 to s3git1 failed:\\ntime=\\"2026-08-28T17:28:30Z\\" level=info msg=\\"\u27a4 INFO Selected service: s3git1\\"\\ntime=\\"2026-08-28T17:28:30Z\\" level=error msg=\\"\u2717 ERR File zerops.yml not found. Checked paths: [/var/www/zerops.yaml, /var/www/zerops.yml]. \\"\\ntime=\\"2026-08-28T17:28:30Z\\" level=error msg=\\"\u2717 ERR  Please, create a zerops.yml file in the root directory of your project. \\"\\ntime=\\"2026-08-28T17:28:30Z\\" level=error msg=\\"\u2717 ERR  Alternatively you can use the --zerops-yaml flag to specify the path to the zerops.yml file or \\"\\ntime=\\"2026-08-28T17:28:30Z\\" level=error msg=\\"\u2717 ERR  use the --working-dir flag to set the working directory to the directory where the zerops.yml file is located.\\"","suggestion":"Check the diagnostic field for full command output.","diagnostic":"Using config file: /home/zerops/.config/zerops/.zcli.yml\\ntime=\\"2026-08-28T17:28:30Z\\" level=info msg=\\"\u2714 DONE You are logged as zcp-z3-eval <token-xxxxxxxxxxxxxxxxxxxxxx@zerops.io>\\"\\nUsing config file: /home/zerops/.config/zerops/.zcli.yml\\ntime=\\"2026-08-28T17:28:30Z\\" level=info msg=\\"\u27a4 INFO Selected service: s3git1\\"\\ntime=\\"2026-08-28T17:28:30Z\\" level=error msg=\\"\u2717 ERR File zerops.yml not found. Checked paths: [/var/www/zerops.yaml, /var/www/zerops.yml]. \\"\\ntime=\\"2026-08-28T17:28:30Z\\" level=error msg=\\"\u2717 ERR  Please, create a zerops.yml file in the root directory of your project. \\"\\ntime=\\"2026-08-28T17:28:30Z\\" level=error msg=\\"\u2717 ERR  Alternatively you can use the --zerops-yaml flag to specify the path to the zerops.yml file or \\"\\ntime=\\"2026-08-28T17:28:30Z\\" level=error msg=\\"\u2717 ERR  use the --working-dir flag to set the working directory to the directory where the zerops.yml file is located.\\"\\n","recovery":{"tool":"zerops_workflow","action":"status"},"failureClassification":{"category":"network","likelyCause":"Transport-layer error reaching the platform.","suggestedAction":"Check the diagnostic field for the underlying SSH/zcli/git error.","signals":["phase:transport"]}}';
