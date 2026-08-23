// GENERATED SCHEMA SNAPSHOT. DO NOT EDIT BY HAND.
// Source: `codex app-server generate-ts --out <dir>`
// Supported CLI: @openai/codex 0.149.0

export const CODEX_APP_SERVER_CLI_VERSION = "0.149.0" as const;

export type CodexApprovalPolicy =
  | "untrusted"
  | "on-request"
  | {
      granular: {
        sandbox_approval: boolean;
        rules: boolean;
        skill_approval: boolean;
        request_permissions: boolean;
        mcp_elicitations: boolean;
      };
    }
  | "never";

export type CodexThreadSandbox =
  "read-only" | "workspace-write" | "danger-full-access";

export type CodexUserTextInput = {
  type: "text";
  text: string;
  text_elements: [];
};

export type CodexWorkspaceWriteSandboxPolicy = {
  type: "workspaceWrite";
  writableRoots: string[];
  networkAccess: boolean;
  excludeTmpdirEnvVar: boolean;
  excludeSlashTmp: boolean;
};

export type CodexCommandExecutionApprovalDecision =
  "accept" | "acceptForSession" | "decline" | "cancel";

export type CodexThreadReadResponse = {
  thread: Record<string, unknown>;
};

export type CodexThreadStartResponse = CodexThreadReadResponse;
export type CodexThreadResumeResponse = CodexThreadReadResponse;
export type CodexTurnStartResponse = {
  turn: { id: string };
};
