import { createInterface } from "node:readline/promises";

export async function operatorCheckpoint(
  please: string,
  promptText = "Press Return when complete. ",
): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("the live proof requires an interactive terminal");
  }
  console.log(JSON.stringify({ checkpoint: "operator", please }));
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question(promptText);
  } finally {
    prompt.close();
  }
}
