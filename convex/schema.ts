import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Active Audio Sharing Rooms
  sessions: defineTable({
    code: v.string(), // e.g. "SS-A9DF"
    hostName: v.string(),
    passcode: v.string(),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  // Connected Mobile Listeners
  listeners: defineTable({
    sessionCode: v.string(),
    listenerName: v.string(),
    listenerId: v.string(),
  }).index("by_session", ["sessionCode"]),

  // Real-Time WebRTC Handshake Signals (Offers, Answers, ICE Candidates)
  signals: defineTable({
    sessionCode: v.string(),
    target: v.string(), // Socket/ID of the target recipient
    from: v.string(), // Sender ID
    type: v.string(), // "offer" | "answer" | "ice"
    payload: v.string(), // JSON stringified SDP or ICE candidate
  }).index("by_target", ["target"]),
});
