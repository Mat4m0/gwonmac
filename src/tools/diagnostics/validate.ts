import { resolve } from "node:path";
import { withCapture, validateCapture } from "./common.js";

const input = process.argv[2];
if (!input) {
  console.error("usage: pnpm diagnostics:validate <capture.gwdiag>");
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
