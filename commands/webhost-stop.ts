import type {AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import WebHostService from "../WebHostService.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

async function execute({
                         agent,
                       }: AgentCommandInputType<typeof inputSchema>): Promise<string> {
  const webHost = agent.requireServiceByType(WebHostService);
  await webHost.stop();
  return "Web host stopped";
}

export default {
  name: "webhost stop",
  description: "Stop the web host",
  inputSchema,
  execute,
  help: "Stops the web host server.\n\n## Usage\n/webhost stop",
} satisfies TokenRingAgentCommand<typeof inputSchema>;
