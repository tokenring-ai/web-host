import TokenRingApp from "@tokenring-ai/app";
import {z} from "zod";

export type JsonRPCImplementation<T extends JsonRPCSchema> = {
  [P in keyof T["methods"]]: T["methods"][P]["type"] extends "stream"
    ? (args: z.infer<T["methods"][P]["input"]>, app: TokenRingApp, signal: AbortSignal) => AsyncGenerator<z.infer<T["methods"][P]["result"]>>
    : (args: z.infer<T["methods"][P]["input"]>, app: TokenRingApp) => Promise<z.infer<T["methods"][P]["result"]>> | z.infer<T["methods"][P]["result"]>;
}
export type JsonRPCSchema = {
  path: string;
  methods: {
    [method: string]: {
      type: "query" | "mutation" | "stream";
      input: z.ZodSchema;
      result: z.ZodSchema;
    };
  };
}
export type JsonRpcMethod<InputSchema extends z.ZodObject<any>, ResultSchema extends z.ZodTypeAny, Type extends "query" | "mutation" | "stream"> = {
  type: Type;
  inputSchema: InputSchema;
  resultSchema: ResultSchema;
  execute: Type extends "stream"
    ? (args: z.infer<InputSchema>, app: TokenRingApp, signal: AbortSignal) => AsyncGenerator<z.infer<ResultSchema>>
    : (args: z.infer<InputSchema>, app: TokenRingApp) => z.infer<ResultSchema>;
};
export type JsonRpcEndpoint = {
  path: string;
  methods: Record<string, JsonRpcMethod<any, any, any>>;
}