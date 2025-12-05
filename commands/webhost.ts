import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingAgentCommand} from "@tokenring-ai/agent/types";
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

function execute(_remainder: string | undefined, agent: Agent): void {
  const webHost = agent.getServiceByType(WebHostService);
  
  if (!webHost) {
    agent.errorLine("WebHostService is not running");
    return;
  }

  const resources = webHost.resources.getAllItemNames();

  agent.infoLine(`Web host running at: ${webHost.getURL()}`);
  
  if (resources.length > 0) {
    agent.infoLine("Registered resources:");
    for (const name of resources) {
      agent.infoLine(`  - ${name}`);
    }
  } else {
    agent.infoLine("No resources registered");
  }
}

export default {
  description,
  execute,
  help,
} as TokenRingAgentCommand;
