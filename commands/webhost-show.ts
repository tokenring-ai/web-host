import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import WebHostService from "../WebHostService.ts";

const description = "Show web host URL and available resources";

const help = `Displays the current web host URL and lists all registered resources.

## Usage
/webhost show`;

const inputSchema = {} as const satisfies AgentCommandInputSchema;

function execute({ agent }: AgentCommandInputType<typeof inputSchema>): string {
  const webHost = agent.requireServiceByType(WebHostService);

  const resources = webHost.resources.keysArray();

  const lines: string[] = [`Web host running at: ${webHost.getURL()}`];

  if (resources.length > 0) {
    lines.push("Registered resources:");
    lines.push(markdownList(resources));
  } else {
    lines.push("No resources registered");
  }

  return lines.join("\n");
}

export default {
  name: "webhost show",
  description,
  inputSchema,
  execute,
  help,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
