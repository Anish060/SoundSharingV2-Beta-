export declare const createSession: import("convex/server").RegisteredMutation<"public", {
    hostName: string;
    passcode: string;
}, Promise<{
    code: string;
    sessionId: import("convex/values").GenericId<"sessions">;
}>>;
export declare const joinSession: import("convex/server").RegisteredMutation<"public", {
    code: string;
    passcode: string;
    listenerName: string;
}, Promise<{
    ok: false;
    error: string;
    sessionCode?: undefined;
    listenerId?: undefined;
} | {
    ok: true;
    sessionCode: string;
    listenerId: string;
    error?: undefined;
}>>;
export declare const sendSignal: import("convex/server").RegisteredMutation<"public", {
    sessionCode: string;
    type: string;
    target: string;
    from: string;
    payload: string;
}, Promise<void>>;
export declare const getIncomingSignals: import("convex/server").RegisteredQuery<"public", {
    target: string;
}, Promise<{
    _id: import("convex/values").GenericId<"signals">;
    _creationTime: number;
    sessionCode: string;
    type: string;
    target: string;
    from: string;
    payload: string;
}[]>>;
export declare const clearSignal: import("convex/server").RegisteredMutation<"public", {
    id: import("convex/values").GenericId<"signals">;
}, Promise<void>>;
//# sourceMappingURL=signaling.d.ts.map