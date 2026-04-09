import createTestingApp from '@tokenring-ai/app/test/createTestingApp';
import {RpcEndpoint} from '@tokenring-ai/rpc/types';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import JsonRpcResource from './JsonRpcResource';
import {BunRouter} from './types';

describe('JsonRpcResource', () => {
  let resource: JsonRpcResource;
  let mockApp: any;
  let mockRouter: BunRouter;
  let mockEndpoint: RpcEndpoint;
  let registeredHandler: any;

  beforeEach(() => {
    mockApp = createTestingApp();
    registeredHandler = null;
    
    mockRouter = {
      post: vi.fn((path, handler) => {
        registeredHandler = handler;
      }),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      ws: vi.fn(),
      static: vi.fn(),
      fallback: vi.fn()
    };
    
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
      await resource.register(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledWith(
        '/api/rpc',
        expect.any(Function)
      );
    });

    it('should handle request with valid JSON-RPC 2.0 format', async () => {
      const mockHandler = vi.fn().mockResolvedValue({ result: 'success' });
      const mockRequest: any = {
        method: 'POST',
        url: 'http://localhost/api/rpc',
        path: '/api/rpc',
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 1,
          method: 'testMethod',
          params: { param1: 'value1' }
        }),
        text: vi.fn(),
        body: vi.fn(),
        arrayBuffer: vi.fn()
      };
      
      const mockResponse: any = {
        json: vi.fn((data) => new Response(JSON.stringify(data))),
        text: vi.fn(),
        file: vi.fn(),
        html: vi.fn(),
        redirect: vi.fn(),
        stream: vi.fn()
      };

      mockEndpoint.methods = {
        testMethod: {
          type: 'query' as const,
          inputSchema: z.object({ param1: z.string() }),
          resultSchema: z.object({ result: z.string() }),
          execute: mockHandler
        }
      };

      await resource.register(mockRouter);
      
      const result = await registeredHandler(mockRequest, mockResponse);
      
      // Verify the response is a Response object with JSON content
      expect(result).toBeInstanceOf(Response);
      const responseText = await result.text();
      const responseData = JSON.parse(responseText);
      
      expect(responseData).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { result: 'success' }
      });
    });

    it('should reject invalid JSON-RPC version', async () => {
      const mockRequest: any = {
        method: 'POST',
        url: 'http://localhost/api/rpc',
        path: '/api/rpc',
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({
          jsonrpc: '1.0',
          id: 1,
          method: 'testMethod'
        }),
        text: vi.fn(),
        body: vi.fn(),
        arrayBuffer: vi.fn()
      };
      
      const mockResponse: any = {
        json: vi.fn((data) => new Response(JSON.stringify(data))),
        text: vi.fn(),
        file: vi.fn(),
        html: vi.fn(),
        redirect: vi.fn(),
        stream: vi.fn()
      };

      await resource.register(mockRouter);
      
      await registeredHandler(mockRequest, mockResponse);

      expect(mockResponse.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' }
      });
    });

    it('should reject when method not found', async () => {
      const mockRequest: any = {
        method: 'POST',
        url: 'http://localhost/api/rpc',
        path: '/api/rpc',
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 1,
          method: 'nonexistentMethod'
        }),
        text: vi.fn(),
        body: vi.fn(),
        arrayBuffer: vi.fn()
      };
      
      const mockResponse: any = {
        json: vi.fn((data) => new Response(JSON.stringify(data))),
        text: vi.fn(),
        file: vi.fn(),
        html: vi.fn(),
        redirect: vi.fn(),
        stream: vi.fn()
      };

      await resource.register(mockRouter);
      
      await registeredHandler(mockRequest, mockResponse);

      expect(mockResponse.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' }
      });
    });

    it('should handle parameter validation errors', async () => {
      const mockRequest: any = {
        method: 'POST',
        url: 'http://localhost/api/rpc',
        path: '/api/rpc',
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 1,
          method: 'testMethod',
          params: { invalid: 'params' }
        }),
        text: vi.fn(),
        body: vi.fn(),
        arrayBuffer: vi.fn()
      };
      
      const mockResponse: any = {
        json: vi.fn((data) => new Response(JSON.stringify(data))),
        text: vi.fn(),
        file: vi.fn(),
        html: vi.fn(),
        redirect: vi.fn(),
        stream: vi.fn()
      };

      mockEndpoint.methods = {
        testMethod: {
          type: 'query' as const,
          inputSchema: z.object({ param1: z.string() }),
          resultSchema: z.object({ result: z.string() }),
          execute: vi.fn()
        }
      };

      await resource.register(mockRouter);
      
      await registeredHandler(mockRequest, mockResponse);

      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: { code: -32603, message: expect.any(String) }
      }));
    });

    it('should handle execution errors', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('Execution failed'));
      const mockRequest: any = {
        method: 'POST',
        url: 'http://localhost/api/rpc',
        path: '/api/rpc',
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 1,
          method: 'testMethod',
          params: { param1: 'value1' }
        }),
        text: vi.fn(),
        body: vi.fn(),
        arrayBuffer: vi.fn()
      };
      
      const mockResponse: any = {
        json: vi.fn((data) => new Response(JSON.stringify(data))),
        text: vi.fn(),
        file: vi.fn(),
        html: vi.fn(),
        redirect: vi.fn(),
        stream: vi.fn()
      };

      mockEndpoint.methods = {
        testMethod: {
          type: 'query' as const,
          inputSchema: z.object({ param1: z.string() }),
          resultSchema: z.object({ result: z.string() }),
          execute: mockHandler
        }
      };

      await resource.register(mockRouter);
      
      await registeredHandler(mockRequest, mockResponse);

      expect(mockResponse.json).toHaveBeenCalledWith({
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
      
      const mockRequest: any = {
        method: 'POST',
        url: 'http://localhost/api/rpc',
        path: '/api/rpc',
        headers: new Headers(),
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 1,
          method: 'streamMethod',
          params: { param1: 'value1' }
        }),
        text: vi.fn(),
        body: vi.fn(),
        arrayBuffer: vi.fn()
      };
      
      const mockResponse: any = {
        json: vi.fn(),
        text: vi.fn(),
        file: vi.fn(),
        html: vi.fn(),
        redirect: vi.fn(),
        stream: vi.fn()
      };

      mockEndpoint.methods = {
        streamMethod: {
          type: 'stream' as const,
          inputSchema: z.object({ param1: z.string() }),
          resultSchema: z.string(),
          execute: mockStreamHandler
        }
      };

      await resource.register(mockRouter);
      
      await registeredHandler(mockRequest, mockResponse);

      expect(mockResponse.stream).toHaveBeenCalled();
    });
  });
});
