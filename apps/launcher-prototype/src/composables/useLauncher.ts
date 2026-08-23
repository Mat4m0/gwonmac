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
  const fundingPlacement = ref<FundingPlacement>("home");
  const settingsSection = ref<SettingsSection>("updates");
  const selectedAccountId = ref("main");
  const settings = reactive(createDefaultSettings());
  const accounts = ref<Account[]>(createDefaultAccounts());
  const toast = ref("");
  const signInAccountId = ref<string | null>(null);
  const addAccountOpen = ref(false);
  const fundingOpen = ref(false);
  const accountMenuOpen = ref(false);
  const fundingRaised = ref(42);
  const fundingGoal = 125;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const selectedAccount = computed(
    () => accounts.value.find((account) => account.id === selectedAccountId.value) ?? accounts.value[0],
  );
  const runningAccounts = computed(() =>
    accounts.value.filter((account) => account.status === "running"),
  );
  const canPlay = computed(() => scenario.value !== "offline");

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

  const selectAccount = (accountId: string) => {
    selectedAccountId.value = accountId;
    accountMenuOpen.value = false;
  };

  const launchAccount = (accountId: string) => {
    const account = accounts.value.find((item) => item.id === accountId);
    if (!account) return;
    selectedAccountId.value = accountId;
    accountMenuOpen.value = false;

    if (scenario.value === "offline") {
      showToast("Guild Wars cannot start while the game files are unavailable.");
      return;
    }
    if (account.status === "login-required") {
      signInAccountId.value = accountId;
      return;
    }
    if (account.status === "running") {
      showToast(`${account.name} is already running.`);
      return;
    }
    if (!settings.multipleWindows) {
      accounts.value.forEach((item) => {
        if (item.status === "running") item.status = "ready";
      });
    }
    account.status = "running";
    showToast(`${account.name} started.`);
  };

  const stopAccount = (accountId: string) => {
    const account = accounts.value.find((item) => item.id === accountId);
    if (!account || account.status !== "running") return;
    account.status = "ready";
    showToast(`${account.name} stopped.`);
  };

  const completeSignIn = () => {
    const account = accounts.value.find((item) => item.id === signInAccountId.value);
    if (!account) return;
    account.status = "ready";
    signInAccountId.value = null;
    launchAccount(account.id);
  };

  const addAccount = (name: string) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const account: Account = {
      id: `account-${accounts.value.length + 1}`,
      name: cleanName,
      note: "Sign in before playing",
      initial: cleanName.slice(0, 1).toUpperCase(),
      status: "login-required",
    };
    accounts.value.push(account);
    selectedAccountId.value = account.id;
    addAccountOpen.value = false;
    showToast(`${account.name} added.`);
  };

  const reset = () => {
    route.value = "home";
    scenario.value = "ready";
    fundingPlacement.value = "home";
    settingsSection.value = "updates";
    selectedAccountId.value = "main";
    accounts.value = createDefaultAccounts();
    Object.assign(settings, createDefaultSettings());
    signInAccountId.value = null;
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
    canPlay,
    completeSignIn,
    fundingGoal,
    fundingOpen,
    fundingPlacement,
    fundingRaised,
    launchAccount,
    navigate,
    reset,
    route,
    runningAccounts,
    scenario,
    selectAccount,
    selectedAccount,
    selectedAccountId,
    settings,
    settingsSection,
    showToast,
    signInAccountId,
    stopAccount,
    toast,
  };
};
