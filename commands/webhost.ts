import type {AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import WebHostService from "../WebHostService.ts";

const description = "Show web host URL and available resources";

const help = `Displays the current web host URL and lists all registered resources.

## Usage
/webhost

## Output
- Web host URL with port
- List of registered resources and their names

## Example
/webhost
# Output:
# Web host running at: http://localhost:3000
# Registered resources:
#   - trpcBackend
#   - defaultFrontend`;

const inputSchema = {} as const satisfies AgentCommandInputSchema;

async function execute({agent}: AgentCommandInputType<typeof inputSchema>): Promise<string> {
  const webHost = agent.getServiceByType(WebHostService);
  
  if (!webHost) {
    return "WebHostService is not running";
  }

  const resources = webHost.resources.getAllItemNames();

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
  name: "webhost",
  description,
  inputSchema,
  execute,
  help,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
