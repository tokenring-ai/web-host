/**
 * RPC methods a `member` may not call, as full ids (`<endpoint path>.<method>`).
 *
 * This is one explicit deny-list, enforced centrally before any method runs (WsRpcResource), so a
 * plugin cannot forget to check. Anything not listed is open to every signed-in user. Because it is a
 * deny-list, a NEW security-relevant method must be added here; backend/test/adminOnlyMethods.test.ts
 * fails when a listed name is not a real registered method (typos would silently open a hole) and
 * prints nothing for methods that were never listed, so review new RPC methods with this file in mind.
 *
 * Members are a trust level, not a sandbox: they can still chat with agents that run shell commands and
 * edit files with the server's permissions, subject to the normal approvals.
 */

const methods = (path: string, names: string[]): string[] => names.map(name => `${path}.${name}`);

export const ADMIN_ONLY_METHODS: readonly string[] = [
  // Account management (createMyAccessLink and getMe are open to everyone signed in).
  ...methods("/rpc/users", [
    "getRemoteAccessInfo",
    "listUsers",
    "listAccessLinks",
    "createUser",
    "createAccessLink",
    "setPassword",
    "setRole",
    "signOutUser",
    "removeUser",
    "revokeAccessLink",
  ]),
  // Tool permission grants and approval levels, and custom tool definitions.
  ...methods("/rpc/chat", [
    "grantPermission",
    "revokePermissionGrant",
    "setToolApproval",
    "createToolDefinition",
    "updateToolDefinition",
    "deleteToolDefinition",
  ]),
  // Configuration: reading it (even redacted) and every way of changing it.
  ...methods("/rpc/config", ["getConfigSchema", "getConfigValues", "validateConfig", "applyConfig", "resetConfig"]),
  // The credential vault: every method, reads and writes.
  ...methods("/rpc/vault", [
    "listEntries",
    "streamEntries",
    "getItem",
    "setItems",
    "deleteItems",
    "moveItem",
    "createCategory",
    "getStatus",
    "streamStatus",
    "lock",
    "unlock",
    "createVault",
    "changePassword",
  ]),
  // Bots: who may talk to them, escalation targets, and their configuration.
  ...methods("/rpc/bot", [
    "createBot",
    "updateBot",
    "deleteBot",
    "setUserRole",
    "removeUser",
    "joinChannel",
    "leaveChannel",
    "updateChannel",
    "setEscalation",
    "testEscalation",
    "setGroup",
    "deleteGroup",
  ]),
  // Installing, updating and removing marketplace code and content.
  ...methods("/rpc/marketplace", ["installMarketplaceItem", "updateMarketplaceItem", "uninstallMarketplaceItem"]),
  // Schedules can run tools unattended.
  ...methods("/rpc/scheduler", ["addSchedule", "updateSchedule", "removeSchedule", "setScheduleEnabled", "runSchedule", "setSchedulerRunning", "clearHistory"]),
  // Model provider credentials and catalogs.
  ...methods("/rpc/ai-client", ["connectProvider", "disconnectProvider", "updateProviderModels", "discoverModels", "updateCatalog"]),
  // Third-party account connections (OAuth clients and tokens).
  ...methods("/rpc/google", ["getSetup", "saveCredentials", "startConnect", "getConnectStatus", "cancelConnect", "updateAccountServices", "disconnectAccount"]),
  ...methods("/rpc/github", ["beginAuthorization", "revokeAuthorization"]),
  // Skills and agent definitions are instructions every agent obeys.
  ...methods("/rpc/skills", ["uploadSkill", "updateSkill", "deleteSkill", "resetSkill"]),
  ...methods("/rpc/agent", ["createAgentDefinition", "updateAgentDefinition", "deleteAgentDefinition"]),
  // Lifecycle hooks run on events.
  ...methods("/rpc/lifecycle", ["setEnabledHooks", "enableHooks", "disableHooks"]),
  // Logs and debug captures can contain other people's conversations and secrets.
  ...methods("/rpc/app", [
    "getLogs",
    "streamLogs",
    "listDebugTargets",
    "captureDebugSnapshot",
    "listDebugSnapshots",
    "readDebugSnapshot",
    "deleteDebugSnapshot",
    "startDebugRecording",
    "stopDebugRecording",
    "streamDebugRecording",
    "setDebugRetention",
  ]),
];

const adminOnly = new Set(ADMIN_ONLY_METHODS);

export function isAdminOnlyMethod(methodId: string): boolean {
  return adminOnly.has(methodId);
}
