declare const _default: import("convex/server").SchemaDefinition<{
    sessions: import("convex/server").TableDefinition<import("convex/values").VObject<{
        hostName: string;
        code: string;
        passcode: string;
        active: boolean;
    }, {
        code: import("convex/values").VString<string, "required">;
        hostName: import("convex/values").VString<string, "required">;
        passcode: import("convex/values").VString<string, "required">;
        active: import("convex/values").VBoolean<boolean, "required">;
    }, "required", "hostName" | "code" | "passcode" | "active">, {
        by_code: ["code", "_creationTime"];
    }, {}, {}>;
    listeners: import("convex/server").TableDefinition<import("convex/values").VObject<{
        sessionCode: string;
        listenerName: string;
        listenerId: string;
    }, {
        sessionCode: import("convex/values").VString<string, "required">;
        listenerName: import("convex/values").VString<string, "required">;
        listenerId: import("convex/values").VString<string, "required">;
    }, "required", "sessionCode" | "listenerName" | "listenerId">, {
        by_session: ["sessionCode", "_creationTime"];
    }, {}, {}>;
    signals: import("convex/server").TableDefinition<import("convex/values").VObject<{
        sessionCode: string;
        type: string;
        target: string;
        from: string;
        payload: string;
    }, {
        sessionCode: import("convex/values").VString<string, "required">;
        target: import("convex/values").VString<string, "required">;
        from: import("convex/values").VString<string, "required">;
        type: import("convex/values").VString<string, "required">;
        payload: import("convex/values").VString<string, "required">;
    }, "required", "sessionCode" | "type" | "target" | "from" | "payload">, {
        by_target: ["target", "_creationTime"];
    }, {}, {}>;
}, true>;
export default _default;
//# sourceMappingURL=schema.d.ts.map