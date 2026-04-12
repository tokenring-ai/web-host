import type {AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand} from "@tokenring-ai/agent/types";
import WebHostService from "../WebHostService.ts";

const inputSchema = {} as const satisfies AgentCommandInputSchema;

async function execute({
                         agent,
                       }: AgentCommandInputType<typeof inputSchema>): Promise<string> {
  const webHost = agent.requireServiceByType(WebHostService);
  await webHost.listen();
  return `Web host started at: ${webHost.getURL()}`;
}

export default {
  name: "webhost start",
  description: "Start the web host",
  inputSchema,
  execute,
  help: "Starts the web host server.\n\n## Usage\n/webhost start",
} satisfies TokenRingAgentCommand<typeof inputSchema>;
