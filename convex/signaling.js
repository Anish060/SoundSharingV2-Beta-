import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
// Host creates a session on Convex Cloud
export const createSession = mutation({
    args: { hostName: v.string(), passcode: v.string() },
    handler: async (ctx, args) => {
        const code = "SS-" + Math.random().toString(36).substring(2, 6).toUpperCase();
        const sessionId = await ctx.db.insert("sessions", {
            code,
            hostName: args.hostName,
            passcode: args.passcode,
            active: true,
        });
        return { code, sessionId };
    },
});
// Listener joins session over Convex Cloud
export const joinSession = mutation({
    args: { code: v.string(), passcode: v.string(), listenerName: v.string() },
    handler: async (ctx, args) => {
        const session = await ctx.db
            .query("sessions")
            .withIndex("by_code", (q) => q.eq("code", args.code))
            .first();
        if (!session || !session.active) {
            return { ok: false, error: "unknown-session" };
        }
        if (session.passcode !== args.passcode) {
            return { ok: false, error: "bad-passcode" };
        }
        const listenerId = Math.random().toString(36).substring(2, 9);
        await ctx.db.insert("listeners", {
            sessionCode: args.code,
            listenerName: args.listenerName,
            listenerId,
        });
        return { ok: true, sessionCode: args.code, listenerId };
    },
});
// Relay WebRTC Offer, Answer, or ICE Candidate
export const sendSignal = mutation({
    args: {
        sessionCode: v.string(),
        target: v.string(),
        from: v.string(),
        type: v.string(),
        payload: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("signals", args);
    },
});
// Reactive Query: Host & Listeners subscribe to incoming WebRTC signals
export const getIncomingSignals = query({
    args: { target: v.string() },
    handler: async (ctx, args) => {
        if (!args.target)
            return [];
        return await ctx.db
            .query("signals")
            .withIndex("by_target", (q) => q.eq("target", args.target))
            .collect();
    },
});
// Clean up processed WebRTC signals
export const clearSignal = mutation({
    args: { id: v.id("signals") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
//# sourceMappingURL=signaling.js.map