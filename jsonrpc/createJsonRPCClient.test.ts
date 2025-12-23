import { describe, it, expect, beforeEach, vi } from 'vitest';
import createJsonRPCClient, { 
  ResultOfRPCCall, 
  ParamsOfRPCCall,
  resetRpcId
} from './createJsonRPCClient';
import { JsonRPCSchema } from './types';
import { z } from 'zod';

// Mock fetch
global.fetch = vi.fn();

describe('createJsonRPCClient', () => {
  let schemas: JsonRPCSchema;
  let baseURL: URL;

  beforeEach(() => {
    vi.clearAllMocks();

    resetRpcId();
    
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

    baseURL = new URL('http://localhost:3000');
  });

  it('should create client with correct methods', () => {
    const client = createJsonRPCClient(baseURL, schemas);
    
    expect(client).toHaveProperty('testQuery');
    expect(client).toHaveProperty('testMutation');
    expect(client).toHaveProperty('testStream');
    expect(typeof client.testQuery).toBe('function');
    expect(typeof client.testMutation).toBe('function');
    expect(typeof client.testStream).toBe('function');
  });

  it('should make query call', async () => {
    const mockResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { response: 'Hello world' }
    };

    (fetch as vi.MockedFunction<typeof fetch>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse)
    });

    const client = createJsonRPCClient(baseURL, schemas);
    const result = await client.testQuery({ message: 'world' });

    expect(result).toEqual({ response: 'Hello world' });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'testQuery',
          params: { message: 'world' }
        })
      }
    );
    expect((fetch as any).mock.calls[0][0].toString()).toBe('http://localhost:3000/api/rpc');
  });

  it('should make mutation call', async () => {
    const mockResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { doubled: 42 }
    };

    (fetch as vi.MockedFunction<typeof fetch>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse)
    });

    const client = createJsonRPCClient(baseURL, schemas);
    const result = await client.testMutation({ value: 21 });

    expect(result).toEqual({ doubled: 42 });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'testMutation',
          params: { value: 21 }
        })
      }
    );
    expect((fetch as any).mock.calls[0][0].toString()).toBe('http://localhost:3000/api/rpc');
  });

  it('should handle RPC errors', async () => {
    const mockError = {
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32601, message: 'Method not found' }
    };

    (fetch as vi.MockedFunction<typeof fetch>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(mockError)
    });

    const client = createJsonRPCClient(baseURL, schemas);

    await expect(client.testQuery({ message: 'test' }))
      .rejects.toThrow('Method not found');
  });

  it('should create stream method', async () => {
    const mockStreamResponse = new Response('data: {"result": {"response": "event1"}}\n\ndata: {"result": {"response": "event2"}}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    });

    (fetch as vi.MockedFunction<typeof fetch>).mockResolvedValueOnce(mockStreamResponse);

    const client = createJsonRPCClient(baseURL, schemas);
    const abortController = new AbortController();
    const stream = client.testStream({ count: 2 }, abortController.signal);

    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
      if (events.length >= 2) break;
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ response: 'event1' });
    expect(events[1]).toEqual({ response: 'event2' });
  });

  it('should handle empty methods', () => {
    const emptySchemas: JsonRPCSchema = {
      path: '/api/empty',
      methods: {}
    };

    const client = createJsonRPCClient(baseURL, emptySchemas);
    
    expect(Object.keys(client)).toHaveLength(0);
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

    const client = createJsonRPCClient(baseURL, singleMethodSchemas);
    
    expect(client).toHaveProperty('ping');
    expect(typeof client.ping).toBe('function');
  });

  it('should increment RPC ID for each call', async () => {
    const mockResponse1 = {
      jsonrpc: '2.0',
      id: 1,
      result: { response: 'first' }
    };

    const mockResponse2 = {
      jsonrpc: '2.0',
      id: 2,
      result: { response: 'second' }
    };

    (fetch as vi.MockedFunction<typeof fetch>)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse1)
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse2)
      });

    const client = createJsonRPCClient(baseURL, schemas);
    
    await client.testQuery({ message: 'first' });
    await client.testQuery({ message: 'second' });

    const calls = (fetch as vi.MockedFunction<typeof fetch>).mock.calls;
    expect(JSON.parse(calls[0][1].body as string).id).toBe(1);
    expect(JSON.parse(calls[1][1].body as string).id).toBe(2);
  });

  it('should handle network errors', async () => {
    (fetch as vi.MockedFunction<typeof fetch>).mockRejectedValueOnce(
      new Error('Network error')
    );

    const client = createJsonRPCClient(baseURL, schemas);

    await expect(client.testQuery({ message: 'test' }))
      .rejects.toThrow('Network error');
  });

  it('should create correct type definitions', () => {
    const client = createJsonRPCClient(baseURL, schemas);
    
    const queryType: ResultOfRPCCall<typeof schemas, 'testQuery'> = { response: 'test' };
    const queryParams: ParamsOfRPCCall<typeof schemas, 'testQuery'> = { message: 'test' };
    
    expect(queryType).toBeDefined();
    expect(queryParams).toBeDefined();
  });
});