import TokenRingApp from "@tokenring-ai/app";
import {z} from "zod";

export type JsonRPCImplementation<T extends JsonRPCSchema> = {
  [P in keyof T["methods"]]: (args: z.infer<T["methods"][P]["input"]>, app: TokenRingApp) => Promise<z.infer<T["methods"][P]["result"]>> | z.infer<T["methods"][P]["result"]>;
}
export type JsonRPCSchema = {
  path: string;
  methods: {
    [method: string]: {
      type: "query" | "mutation";
      input: z.ZodSchema;
      result: z.ZodSchema;
    };
  };
}
type JsonRpcMethod<InputSchema extends z.ZodObject<any>, ResultSchema extends z.ZodTypeAny> = {
  inputSchema: InputSchema;
  resultSchema: ResultSchema;
  execute: (args: z.infer<InputSchema>, app: TokenRingApp) => z.infer<ResultSchema>;
};
export type JsonRpcEndpoint = {
  path: string;
  methods: Record<string, JsonRpcMethod<any, any>>;
}