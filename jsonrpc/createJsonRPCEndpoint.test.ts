import TokenRingApp from '@tokenring-ai/app';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {createJsonRPCEndpoint} from './createJsonRPCEndpoint';
import {JsonRPCImplementation, JsonRPCSchema} from './types';

// Mock TokenRingApp
vi.mock('@tokenring-ai/app', () => ({
  default: class MockTokenRingApp {
    serviceOutput = vi.fn();
    serviceError = vi.fn();
  }
}));

describe('createJsonRPCEndpoint', () => {
  let mockApp: any;
  let schemas: JsonRPCSchema;
  let implementation: JsonRPCImplementation<typeof schemas>;

  beforeEach(() => {
    mockApp = new TokenRingApp();
    
    schemas = {
      path: '/api/rpc',
      methods: {
        testQuery: {
          type: 'query' as const,
          input: z.object({ message: z.string() }),
          result: z.object({ response: z.string() })
        },
        testMutation: {
          type: 'mutation' as const,
          input: z.object({ value: z.number() }),
          result: z.object({ doubled: z.number() })
        },
        testStream: {
          type: 'stream' as const,
          input: z.object({ count: z.number() }),
          result: z.object({ number: z.number() })
        }
      }
    };

    implementation = {
      testQuery: async (args: any, app: any) => {
        return { response: `Hello ${args.message}` };
      },
      testMutation: async (args: any, app: any) => {
        return { doubled: args.value * 2 };
      },
      testStream: async function* (args: any, app: any, signal: AbortSignal) {
        for (let i = 0; i < args.count; i++) {
          if (signal.aborted) break;
          yield { number: i };
        }
      }
    };
  });

  it('should create endpoint with correct path', () => {
    const endpoint = createJsonRPCEndpoint(schemas, implementation);
    
    expect(endpoint.path).toBe('/api/rpc');
  });

  it('should convert query method', () => {
    const endpoint = createJsonRPCEndpoint(schemas, implementation);
    
    expect(endpoint.methods.testQuery).toEqual({
      type: 'query',
      inputSchema: schemas.methods.testQuery.input,
      resultSchema: schemas.methods.testQuery.result,
      execute: implementation.testQuery
    });
  });

  it('should convert mutation method', () => {
    const endpoint = createJsonRPCEndpoint(schemas, implementation);
    
    expect(endpoint.methods.testMutation).toEqual({
      type: 'mutation',
      inputSchema: schemas.methods.testMutation.input,
      resultSchema: schemas.methods.testMutation.result,
      execute: implementation.testMutation
    });
  });

  it('should convert stream method', () => {
    const endpoint = createJsonRPCEndpoint(schemas, implementation);
    
    expect(endpoint.methods.testStream).toEqual({
      type: 'stream',
      inputSchema: schemas.methods.testStream.input,
      resultSchema: schemas.methods.testStream.result,
      execute: implementation.testStream
    });
  });

  it('should handle empty methods', () => {
    const emptySchemas: JsonRPCSchema = {
      path: '/api/empty',
      methods: {}
    };

    const emptyImplementation: JsonRPCImplementation<typeof emptySchemas> = {};
    
    const endpoint = createJsonRPCEndpoint(emptySchemas, emptyImplementation);
    
    expect(endpoint.path).toBe('/api/empty');
    expect(Object.keys(endpoint.methods)).toHaveLength(0);
  });

  it('should preserve method implementations', () => {
    const endpoint = createJsonRPCEndpoint(schemas, implementation);
    
    const result = endpoint.methods.testQuery.execute(
      { message: 'world' },
      mockApp
    );
    
    expect(result).toBeInstanceOf(Promise);
  });

  it('should handle single method', () => {
    const singleMethodSchemas: JsonRPCSchema = {
      path: '/api/single',
      methods: {
        ping: {
          type: 'query' as const,
          input: z.object({}),
          result: z.object({ pong: z.boolean() })
        }
      }
    };

    const singleMethodImplementation: JsonRPCImplementation<typeof singleMethodSchemas> = {
      ping: async (args: any, app: any) => ({ pong: true })
    };
    
    const endpoint = createJsonRPCEndpoint(singleMethodSchemas, singleMethodImplementation);
    
    expect(endpoint.path).toBe('/api/single');
    expect(Object.keys(endpoint.methods)).toHaveLength(1);
    expect(endpoint.methods.ping).toBeDefined();
  });

  it('should handle mixed method types', () => {
    const endpoint = createJsonRPCEndpoint(schemas, implementation);
    
    const methods = endpoint.methods;
    
    expect(methods.testQuery.type).toBe('query');
    expect(methods.testMutation.type).toBe('mutation');
    expect(methods.testStream.type).toBe('stream');
  });
});