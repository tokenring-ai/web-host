import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import JsonRpcResource from './JsonRpcResource';
import TokenRingApp from '@tokenring-ai/app';
import createTestingApp from '@tokenring-ai/app/test/createTestingApp';
import { JsonRpcEndpoint } from './jsonrpc/types';
import { z } from 'zod';

describe('JsonRpcResource', () => {
  let resource: JsonRpcResource;
  let mockApp: any;
  let mockServer: FastifyInstance;
  let mockEndpoint: JsonRpcEndpoint;

  beforeEach(() => {
    mockApp = createTestingApp();
    mockServer = {
      post: vi.fn()
    } as any;
    
    mockEndpoint = {
      path: '/api/rpc',
      methods: {}
    };
    
    resource = new JsonRpcResource(mockApp, mockEndpoint);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with app and endpoint', () => {
      expect(resource).toBeInstanceOf(JsonRpcResource);
    });
  });

  describe('register method', () => {
    it('should register POST endpoint', async () => {
      await resource.register(mockServer);

      expect(mockServer.post).toHaveBeenCalledWith(
        '/api/rpc',
        expect.any(Function)
      );
    });

    it('should handle request with valid JSON-RPC 2.0 format', async () => {
      const mockHandler = vi.fn().mockResolvedValue({ result: 'success' });
      const mockRequest = {
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'testMethod',
          params: { param1: 'value1' }
        }
      };
      
      const mockReply = {
        send: vi.fn()
      };

      mockEndpoint.methods = {
        testMethod: {
          type: 'query' as const,
          inputSchema: z.object({ param1: z.string() }),
          resultSchema: z.object({ result: z.string() }),
          execute: mockHandler
        }
      };

      await resource.register(mockServer);

      const registerCallback = mockServer.post.mock.calls[0][1];
      await registerCallback(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 1,
        result: { result: 'success' }
      });
    });

    it('should reject invalid JSON-RPC version', async () => {
      const mockRequest = {
        body: {
          jsonrpc: '1.0',
          id: 1,
          method: 'testMethod'
        }
      };
      
      const mockReply = {
        send: vi.fn()
      };

      await resource.register(mockServer);

      const registerCallback = mockServer.post.mock.calls[0][1];
      await registerCallback(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' }
      });
    });

    it('should reject when method not found', async () => {
      const mockRequest = {
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'nonexistentMethod'
        }
      };
      
      const mockReply = {
        send: vi.fn()
      };

      await resource.register(mockServer);

      const registerCallback = mockServer.post.mock.calls[0][1];
      await registerCallback(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' }
      });
    });

    it('should handle parameter validation errors', async () => {
      const mockRequest = {
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'testMethod',
          params: { invalid: 'params' }
        }
      };
      
      const mockReply = {
        send: vi.fn()
      };

      mockEndpoint.methods = {
        testMethod: {
          type: 'query' as const,
          inputSchema: z.object({ param1: z.string() }),
          resultSchema: z.object({ result: z.string() }),
          execute: vi.fn()
        }
      };

      await resource.register(mockServer);

      const registerCallback = mockServer.post.mock.calls[0][1];
      await registerCallback(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: { code: -32603, message: expect.any(String) }
      }));
    });

    it('should handle execution errors', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('Execution failed'));
      const mockRequest = {
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'testMethod',
          params: { param1: 'value1' }
        }
      };
      
      const mockReply = {
        send: vi.fn()
      };

      mockEndpoint.methods = {
        testMethod: {
          type: 'query' as const,
          inputSchema: z.object({ param1: z.string() }),
          resultSchema: z.object({ result: z.string() }),
          execute: mockHandler
        }
      };

      await resource.register(mockServer);

      const registerCallback = mockServer.post.mock.calls[0][1];
      await registerCallback(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'Execution failed' }
      });
    });

    it('should handle stream methods', async () => {
      const mockStreamHandler = vi.fn().mockImplementation(function* () {
        yield 'event1';
        yield 'event2';
      });
      
      const mockRequest = {
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'streamMethod',
          params: { param1: 'value1' }
        }
      };
      
      const mockReply = {
        raw: {
          writeHead: vi.fn(),
          write: vi.fn(),
          end: vi.fn()
        }
      };

      mockEndpoint.methods = {
        streamMethod: {
          type: 'stream' as const,
          inputSchema: z.object({ param1: z.string() }),
          resultSchema: z.string(),
          execute: mockStreamHandler
        }
      };

      await resource.register(mockServer);

      const registerCallback = mockServer.post.mock.calls[0][1];
      await registerCallback(mockRequest, mockReply);

      expect(mockReply.raw.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
    });
  });
});