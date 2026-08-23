import { describe, expect, it } from "vitest";
import { useLauncher } from "./useLauncher";

describe("launcher account flow", () => {
  it("starts any saved account in its own window", () => {
    const launcher = useLauncher();
    launcher.addAccount("Storage account");
    launcher.launchAccount("main");
    launcher.launchAccount("account-2");
    expect(launcher.runningAccounts.value.map((account) => account.id)).toEqual([
      "main",
      "account-2",
    ]);
  });

  it("starts every account selected for Quick start", () => {
    const launcher = useLauncher();
    launcher.addAccount("Storage account");
    launcher.toggleQuickStart("account-2");
    launcher.launchQuickStart();
    expect(launcher.runningAccounts.value.map((account) => account.id)).toEqual([
      "main",
      "account-2",
    ]);
  });

  it("opens the Quick start picker when no account is selected", () => {
    const launcher = useLauncher();
    launcher.toggleQuickStart("main");
    launcher.launchQuickStart();
    expect(launcher.accountMenuOpen.value).toBe(true);
    expect(launcher.runningAccounts.value).toHaveLength(0);
  });
});
