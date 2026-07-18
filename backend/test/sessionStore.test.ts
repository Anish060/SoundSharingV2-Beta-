import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/sessionStore.js";

describe("SessionStore", () => {
  it("creates a session with a unique SS- prefixed code", () => {
    const store = new SessionStore();
    const s = store.create({ hostSocketId: "h1", hostName: "Alice", passcode: "123456" });
    expect(s.sessionCode).toMatch(/^SS-[0-9A-F]{4}$/);
    expect(store.get(s.sessionCode)).toBe(s);
    expect(store.isHostSocket("h1")).toBe(true);
  });

  it("adds listeners and looks up by socket id", () => {
    const store = new SessionStore();
    const s = store.create({ hostSocketId: "h1", hostName: "Alice", passcode: "p" });
    store.addListener(s.sessionCode, { socketId: "l1", listenerName: "Bob", joinedAt: 1 });
    expect(store.getBySocketId("l1")?.sessionCode).toBe(s.sessionCode);
    expect(s.listeners.get("l1")?.listenerName).toBe("Bob");
  });

  it("removes host and evicts all listeners", () => {
    const store = new SessionStore();
    const s = store.create({ hostSocketId: "h1", hostName: "A", passcode: "p" });
    store.addListener(s.sessionCode, { socketId: "l1", listenerName: "B", joinedAt: 1 });
    store.addListener(s.sessionCode, { socketId: "l2", listenerName: "C", joinedAt: 2 });

    const removed = store.removeSocket("h1");
    expect(removed?.wasHost).toBe(true);
    expect(store.get(s.sessionCode)).toBeUndefined();
    expect(store.getBySocketId("l1")).toBeUndefined();
    expect(store.getBySocketId("l2")).toBeUndefined();
  });

  it("removes a listener without ending the session", () => {
    const store = new SessionStore();
    const s = store.create({ hostSocketId: "h1", hostName: "A", passcode: "p" });
    store.addListener(s.sessionCode, { socketId: "l1", listenerName: "B", joinedAt: 1 });

    const removed = store.removeSocket("l1");
    expect(removed?.wasHost).toBe(false);
    expect(store.get(s.sessionCode)).toBe(s);
    expect(s.listeners.has("l1")).toBe(false);
  });

  it("is case-insensitive on session code lookup", () => {
    const store = new SessionStore();
    const s = store.create({ hostSocketId: "h1", hostName: "A", passcode: "p" });
    expect(store.get(s.sessionCode.toLowerCase())?.sessionCode).toBe(s.sessionCode);
  });
});
