import { describe, expect, it } from "vitest";
import { useLauncher } from "./useLauncher";

describe("launcher account flow", () => {
  it("starts any saved account in its own window", () => {
    const launcher = useLauncher();
    launcher.addAccount({ name: "Storage account", icon: "chest", color: "blue" });
    launcher.launchAccount("main");
    launcher.launchAccount("account-2");
    expect(launcher.runningAccounts.value.map((account) => account.id)).toEqual([
      "main",
      "account-2",
    ]);
  });

  it("starts every account selected for Quick start", () => {
    const launcher = useLauncher();
    launcher.addAccount({ name: "Storage account", icon: "chest", color: "blue" });
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

  it("starts installed game files while news and network features are offline", () => {
    const launcher = useLauncher();
    launcher.scenario.value = "offline";
    launcher.launchQuickStart();
    expect(launcher.runningAccounts.value.map((account) => account.id)).toEqual(["main"]);
  });

  it("updates an account name, icon, and color together", () => {
    const launcher = useLauncher();
    launcher.updateAccount("main", { name: "PvP account", icon: "swords", color: "red" });
    expect(launcher.accounts.value[0]).toMatchObject({
      name: "PvP account",
      icon: "swords",
      color: "red",
    });
  });
});
