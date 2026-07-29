import path from "node:path";
import { writeDistributionChecksums } from "./prepare-preview-artifact.js";

await writeDistributionChecksums(
  path.resolve(import.meta.dirname, "..", "distribution"),
);
