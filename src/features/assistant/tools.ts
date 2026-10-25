import type { AssistantTool } from "@/bindings/AssistantTool";
import type { CliToolInfo } from "@/bindings/CliToolInfo";
import { api } from "@/lib/api";

/** The coding assistants GitPilot can open in a terminal. */
export const ASSISTANT_TOOLS: Record<AssistantTool, { name: string; command: string; installUrl: string; detect: () => Promise<CliToolInfo> }> = {
  claudeCode: { name: "Claude Code", command: "claude", installUrl: "https://docs.claude.com/en/docs/claude-code/setup", detect: () => api.claudeDetect() },
  openCode: { name: "OpenCode", command: "opencode", installUrl: "https://opencode.ai/docs", detect: () => api.openCodeDetect() },
};
