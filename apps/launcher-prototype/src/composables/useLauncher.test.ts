import { describe, expect, it } from "vitest";
import { useLauncher } from "./useLauncher";

describe("launcher account flow", () => {
  it("starts more than one account when multiple windows are enabled", () => {
    const launcher = useLauncher();
    launcher.launchAccount("main");
    launcher.launchAccount("storage");
    expect(launcher.runningAccounts.value.map((account) => account.id)).toEqual([
      "main",
      "storage",
    ]);
  });

  it("keeps one running account when multiple windows are disabled", () => {
    const launcher = useLauncher();
    launcher.settings.multipleWindows = false;
    launcher.launchAccount("main");
    launcher.launchAccount("storage");
    expect(launcher.runningAccounts.value.map((account) => account.id)).toEqual(["storage"]);
  });

  it("asks for sign-in before starting an account without a saved login", () => {
    const launcher = useLauncher();
    launcher.launchAccount("pvp");
    expect(launcher.signInAccountId.value).toBe("pvp");
    expect(launcher.runningAccounts.value).toHaveLength(0);
  });
});
