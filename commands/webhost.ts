import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import WebHostService from "../WebHostService.js";

const description = "/webhost - Show web host URL and available resources";

const help = `# /webhost

## Description
Displays the current web host URL and lists all registered resources.

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

function execute(_remainder: string, agent: Agent): void {
  const webHost = agent.getServiceByType(WebHostService);
  
  if (!webHost) {
    agent.errorMessage("WebHostService is not running");
    return;
  }

  const resources = webHost.resources.getAllItemNames();

  const lines: string[] = [`Web host running at: ${webHost.getURL()}`];
  
  if (resources.length > 0) {
    lines.push("Registered resources:");
    lines.push(markdownList(resources));
  } else {
    lines.push("No resources registered");
  }

  agent.infoMessage(lines.join("\n"));
}

export default {
  description,
  execute,
  help,
} satisfies TokenRingAgentCommand;
