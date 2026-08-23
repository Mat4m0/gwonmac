import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AccountProfileModal from "./AccountProfileModal.vue";

describe("AccountProfileModal", () => {
  it("saves the account name, icon, and color together", async () => {
    const wrapper = mount(AccountProfileModal);

    await wrapper.get("#account-profile-name").setValue("Storage account");
    await wrapper.get("input[value='chest']").setValue(true);
    await wrapper.get("input[value='blue']").setValue(true);
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("save")?.[0]?.[0]).toEqual({
      name: "Storage account",
      icon: "chest",
      color: "blue",
    });
  });
});
