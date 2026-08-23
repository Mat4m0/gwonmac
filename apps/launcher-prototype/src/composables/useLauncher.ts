import { computed, reactive, ref } from "vue";
import {
  createDefaultAccounts,
  createDefaultSettings,
  type Account,
  type FundingPlacement,
  type RouteName,
  type Scenario,
  type SettingsSection,
} from "../model";

export const useLauncher = () => {
  const route = ref<RouteName>("home");
  const scenario = ref<Scenario>("ready");
  const fundingPlacement = ref<FundingPlacement>("bar");
  const settingsSection = ref<SettingsSection>("updates");
  const settings = reactive(createDefaultSettings());
  const accounts = ref<Account[]>(createDefaultAccounts());
  const toast = ref("");
  const addAccountOpen = ref(false);
  const fundingOpen = ref(false);
  const accountMenuOpen = ref(false);
  const fundingRaised = ref(42);
  const fundingGoal = 125;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const runningAccounts = computed(() =>
    accounts.value.filter((account) => account.status === "running"),
  );
  const quickStartAccounts = computed(() =>
    accounts.value.filter((account) => account.quickStart),
  );
  const showToast = (message: string) => {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = "";
    }, 3200);
  };

  const navigate = (nextRoute: RouteName) => {
    route.value = nextRoute;
    accountMenuOpen.value = false;
  };

  const launchAccount = (accountId: string) => {
    const account = accounts.value.find((item) => item.id === accountId);
    if (!account) return;

    if (scenario.value === "offline") {
      showToast("Guild Wars cannot start while the game files are unavailable.");
      return;
    }
    if (account.status === "running") {
      showToast(`${account.name} is already open.`);
      return;
    }
    account.status = "running";
    showToast(`${account.name} started.`);
  };

  const launchQuickStart = () => {
    if (scenario.value === "offline") {
      showToast("Guild Wars cannot start while the game files are unavailable.");
      return;
    }
    if (!quickStartAccounts.value.length) {
      showToast("Choose at least one account for Quick start.");
      accountMenuOpen.value = true;
      return;
    }
    const waiting = quickStartAccounts.value.filter((account) => account.status !== "running");
    if (!waiting.length) {
      showToast("Your Quick start session is already open.");
      return;
    }
    waiting.forEach((account) => {
      account.status = "running";
    });
    accountMenuOpen.value = false;
    showToast(
      waiting.length === 1
        ? `${waiting[0]!.name} started.`
        : `${waiting.length} game windows started.`,
    );
  };

  const toggleQuickStart = (accountId: string) => {
    const account = accounts.value.find((item) => item.id === accountId);
    if (!account) return;
    account.quickStart = !account.quickStart;
  };

  const stopAccount = (accountId: string) => {
    const account = accounts.value.find((item) => item.id === accountId);
    if (!account || account.status !== "running") return;
    account.status = "ready";
    showToast(`${account.name} stopped.`);
  };

  const addAccount = (name: string) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const account: Account = {
      id: `account-${accounts.value.length + 1}`,
      name: cleanName,
      note: "Not played yet",
      initial: cleanName.slice(0, 1).toUpperCase(),
      status: "ready",
      quickStart: false,
    };
    accounts.value.push(account);
    addAccountOpen.value = false;
    showToast(`${account.name} added.`);
  };

  const reset = () => {
    route.value = "home";
    scenario.value = "ready";
    fundingPlacement.value = "bar";
    settingsSection.value = "updates";
    accounts.value = createDefaultAccounts();
    Object.assign(settings, createDefaultSettings());
    addAccountOpen.value = false;
    fundingOpen.value = false;
    accountMenuOpen.value = false;
    showToast("Prototype reset.");
  };

  return {
    accounts,
    accountMenuOpen,
    addAccount,
    addAccountOpen,
    fundingGoal,
    fundingOpen,
    fundingPlacement,
    fundingRaised,
    launchAccount,
    launchQuickStart,
    navigate,
    quickStartAccounts,
    reset,
    route,
    runningAccounts,
    scenario,
    settings,
    settingsSection,
    showToast,
    stopAccount,
    toggleQuickStart,
    toast,
  };
};
