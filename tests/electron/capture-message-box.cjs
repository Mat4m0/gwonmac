/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
// Loaded by NODE_OPTIONS before the Electron main module in the one migration
// spec. It turns native message boxes into a deterministic JSONL receipt.
const fs = require("node:fs");
const { dialog } = require("electron");

const capturePath = process.env.GW_TEST_MESSAGE_BOX_CAPTURE;
if (capturePath) {
  /** @param {...unknown} args */
  const captureMessageBox = async (...args) => {
    const options = args.at(-1);
    fs.appendFileSync(capturePath, `${JSON.stringify(options)}\n`);
    return { response: 0, checkboxChecked: false };
  };
  dialog.showMessageBox = captureMessageBox;
}
