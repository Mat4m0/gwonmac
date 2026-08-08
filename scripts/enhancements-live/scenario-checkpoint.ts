import { createInterface } from "node:readline/promises";

export async function operatorCheckpoint(please: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("toolbox foundation live proof requires an interactive terminal");
  }
  console.log(JSON.stringify({ checkpoint: "operator", please }));
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question("Press Return when complete. ");
  } finally {
    prompt.close();
  }
}
