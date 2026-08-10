/**
 * `pnpm diagnostics:validate`: says whether one diagnostics ZIP is internally
 * consistent, and exits non-zero when it is not.
 *
 * Argument handling and one call into the shared reader. The rules it enforces
 * belong to `common.ts`; this file owns the command's usage line and its exit
 * codes, so no rule is stated twice.
 */
import { resolve } from "node:path";
import { withCapture, validateCapture } from "./common.js";

const input = process.argv[2];
if (!input) {
  console.error("usage: pnpm diagnostics:validate <capture.zip>");
  process.exitCode = 2;
} else {
  await withCapture(resolve(input), (capture) => {
    const errors = validateCapture(capture);
    if (errors.length) {
      for (const error of errors) console.error(`FAIL ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`valid capture ${capture.manifest.sessionId}`);
  });
}
