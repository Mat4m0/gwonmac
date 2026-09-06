/** Covers the real component's conversation lifetime and focus behavior. */
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import { nextTick } from "vue";
import WhispersApp from "./WhispersApp.vue";
import { createWhisperSession } from "../../../src/shared/whisper-session";

afterEach(() => { document.body.replaceChildren(); });

it("keeps recipient, input DOM, draft and focus across incoming updates", async () => {
  const session = createWhisperSession(async () => {});
  session.setAvailable(true); session.open("Test Friend");
  const wrapper = mount(WhispersApp, { props: { session }, attachTo: document.body });
  const field = wrapper.get('input[id="draft-test friend"]');
  await field.setValue("A draft");
  (field.element as HTMLInputElement).focus();
  session.observe([{ id: 1, sender: "Other Friend", message: "Hello", direction: "incoming" }]);
  await nextTick();
  expect(document.activeElement).toBe(field.element);
  expect(session.state.selected).toBe("test friend");
  expect(wrapper.get('input[id="draft-test friend"]').element).toBe(field.element);
  await wrapper.get('[aria-label="Collapse whispers"]').trigger("click");
  expect(session.state.visible).toBe(false);
  session.setVisible(true); await nextTick();
  expect((field.element as HTMLInputElement).value).toBe("A draft");
  wrapper.unmount();
});

it("restores each transcript position and cycles observed sent messages", async () => {
  const session = createWhisperSession(async () => {});
  session.setAvailable(true);
  session.observe([
    { id: 1, sender: "Test Friend", message: "First reply", direction: "outgoing" },
    { id: 2, sender: "Test Friend", message: "Second reply", direction: "outgoing" },
  ]);
  session.showPicker();
  const wrapper = mount(WhispersApp, { props: { session }, attachTo: document.body });
  session.open("Test Friend");
  await flushPromises();
  const transcript = wrapper.get<HTMLElement>("[data-transcript]").element;
  transcript.scrollTop = 37;
  await wrapper.get("[data-transcript]").trigger("scroll");
  session.showPicker();
  await nextTick();
  session.open("Test Friend");
  await flushPromises();
  expect(transcript.scrollTop).toBe(37);

  const field = wrapper.get<HTMLInputElement>('input[id="draft-test friend"]');
  await field.setValue("Unsent thought");
  await field.trigger("keydown", { key: "ArrowUp" });
  expect(field.element.value).toBe("Second reply");
  await field.trigger("keydown", { key: "ArrowUp" });
  expect(field.element.value).toBe("First reply");
  await field.trigger("keydown", { key: "ArrowDown" });
  expect(field.element.value).toBe("Second reply");
  await field.trigger("keydown", { key: "ArrowDown" });
  expect(field.element.value).toBe("Unsent thought");
  wrapper.unmount();
});

it("follows incoming messages only while the reader is at the live edge", async () => {
  const session = createWhisperSession(async () => {});
  session.setAvailable(true);
  session.observe([{ id: 1, sender: "Test Friend", message: "First", direction: "incoming" }]);
  const wrapper = mount(WhispersApp, { props: { session }, attachTo: document.body });
  session.open("Test Friend");
  await flushPromises();
  const transcript = wrapper.get<HTMLElement>("[data-transcript]");
  let contentHeight = 200;
  Object.defineProperties(transcript.element, {
    clientHeight: { configurable: true, get: () => 100 },
    scrollHeight: { configurable: true, get: () => contentHeight },
  });

  transcript.element.scrollTop = 100;
  await transcript.trigger("scroll");
  contentHeight = 240;
  session.observe([{ id: 2, sender: "Test Friend", message: "Second", direction: "incoming" }]);
  await flushPromises();
  expect(transcript.element.scrollTop).toBe(240);

  transcript.element.scrollTop = 20;
  await transcript.trigger("scroll");
  contentHeight = 280;
  session.observe([{ id: 3, sender: "Test Friend", message: "Third", direction: "incoming" }]);
  await flushPromises();
  expect(transcript.element.scrollTop).toBe(20);
  wrapper.unmount();
});

it("requires draft discard to close and only observed outgoing clears a submitted draft", async () => {
  let finish: () => void = () => {};
  const session = createWhisperSession(() => new Promise<void>(resolve => { finish = resolve; }));
  session.setAvailable(true); session.open("Test Friend");
  const wrapper = mount(WhispersApp, { props: { session }, attachTo: document.body });
  await wrapper.get('input[id="draft-test friend"]').setValue("A draft");
  await wrapper.get('[aria-label="Close conversation with Test Friend"]').trigger("click");
  expect(wrapper.text()).toContain("Discard the unsent draft");
  expect(session.state.conversations).toHaveLength(1);
  const keep = wrapper.findAll("button").find(button => button.text() === "Keep chatting")!;
  await keep.trigger("click");
  await wrapper.get("form.whisper-compose").trigger("submit");
  expect(wrapper.text()).toContain("Submitting…");
  expect(session.state.conversations[0]?.messages).toHaveLength(0);
  session.observe([{ id: 1, sender: "Test Friend", message: "A draft", direction: "outgoing" }]);
  finish(); await flushPromises();
  expect((wrapper.get('input[id="draft-test friend"]').element as HTMLInputElement).value).toBe("");
  expect(wrapper.findAll("article")).toHaveLength(1);
  await wrapper.get('[aria-label="Close conversation with Test Friend"]').trigger("click");
  expect(session.state.conversations).toHaveLength(0);
  expect(wrapper.text()).toContain("Start a conversation");
  expect(session.state.recent.map(p => p.name)).toEqual(["Test Friend"]);
  wrapper.unmount();
});


it("shows available friends without hiding offline conversations", async () => {
  const session = createWhisperSession(async () => {});
  session.setAvailable(true); session.showPicker();
  session.updateFriends({ status: "ready", sequence: 1, generation: 1, friends: [
    { key: "a", character: "Online Friend", alias: "Online Friend", status: "online", mapId: 133 },
    { key: "b", character: "Offline Friend", alias: "Offline Friend", status: "offline", mapId: 0 },
    { key: "c", character: "Away Friend", alias: "Away Friend", status: "away", mapId: 133 },
  ] });
  const wrapper = mount(WhispersApp, { props: { session }, attachTo: document.body });
  expect(wrapper.text()).toContain("Available friends");
  expect(wrapper.text()).toContain("Online Friend");
  expect(wrapper.text()).toContain("Online");
  expect(wrapper.text()).toContain("Away Friend");
  expect(wrapper.text()).toContain("Away");
  expect(wrapper.text()).not.toContain("Offline Friend");
  session.open("Offline Friend"); await nextTick();
  expect(wrapper.text()).toContain("Offline");
  session.showPicker(); await nextTick();
  expect(wrapper.text()).toContain("Offline Friend");
  wrapper.unmount();
});

it("suggests recent chat participants and supports keyboard completion", async () => {
  const session = createWhisperSession(async () => {});
  session.setAvailable(true); session.showPicker();
  session.observe([
    { id: 1, sender: "Moon D Eden", direction: "participant" },
    { id: 2, sender: "Ancient N Chains", direction: "participant" },
  ]);
  const wrapper = mount(WhispersApp, { props: { session }, attachTo: document.body });
  const field = wrapper.get<HTMLInputElement>("#whisper-person");
  await field.setValue("mo");
  expect(wrapper.text()).toContain("Moon D Eden");
  expect(wrapper.text()).toContain("Seen in chat");
  expect(wrapper.text()).not.toContain("Ancient N Chains");
  await field.trigger("keydown", { key: "Tab" });
  expect(field.element.value).toBe("Moon D Eden");
  await wrapper.get("form.whisper-search").trigger("submit");
  expect(session.state.selected).toBe("moon d eden");
  wrapper.unmount();
});

it("changes only the messenger background opacity multiplier", async () => {
  const session = createWhisperSession(async () => {});
  session.setAvailable(true); session.setVisible(true);
  const wrapper = mount(WhispersApp, { props: { session }, attachTo: document.body });
  await wrapper.get('[aria-label="Chat options"]').trigger("click");
  await wrapper.get("#whisper-opacity").setValue(20);
  expect(session.state.backgroundOpacity).toBe(20);
  expect(wrapper.get("#whisper-window").attributes("style")).toContain("--whisper-background-opacity: 0.2");
  wrapper.unmount();
});
