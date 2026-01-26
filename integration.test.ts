import TokenRingApp from '@tokenring-ai/app';
import createTestingApp from "@tokenring-ai/app/test/createTestingApp";
import Fastify, {FastifyInstance} from 'fastify';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {registerAuth} from './auth';
import {createRPCEndpoint} from '@tokenring-ai/rpc/createRPCEndpoint';
import JsonRpcResource from './JsonRpcResource';
import SPAResource, {spaResourceConfigSchema} from './SPAResource';
import StaticResource, {staticResourceConfigSchema} from './StaticResource';
import WebHostService from './WebHostService';

vi.mock('@tokenring-ai/utility/promise/waitForAbort', () => ({
  default: vi.fn()
}));

vi.mock('fastify', () => ({
  default: vi.fn()
}));

describe('WebHost Integration Tests', () => {
  let service: WebHostService;
  let mockApp: TokenRingApp;
  let mockServer: FastifyInstance;

  beforeEach(() => {
    mockApp = createTestingApp();
    vi.spyOn(mockApp, 'serviceOutput');
    mockServer = {
      register: vi.fn(),
      setNotFoundHandler: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      addresses: vi.fn(() => [{ port: 3000 }]),
      printRoutes: vi.fn(() => 'Routes'),
      post: vi.fn(),
      addHook: vi.fn(),
      logger: false,
      routerOptions: { ignoreTrailingSlash: true }
    } as any;
    vi.mocked(Fastify).mockReturnValue(mockServer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete WebHost Setup', () => {
    it('should setup web host with all resource types', async () => {
      const config = {
        host: '127.0.0.1',
        port: 3000,
        auth: {
          users: {
            testuser: { password: 'testpass', bearerToken: 'testtoken' }
          }
        },
        resources: {
          static: staticResourceConfigSchema.parse({
            type: 'static',
            root: '/path/to/static',
            description: 'Static files',
            indexFile: 'index.html',
            notFoundFile: '404.html',
            prefix: '/static'
          }),
          spa: spaResourceConfigSchema.parse({
            type: 'spa',
            file: '/path/to/app/index.html',
            description: 'SPA application',
            prefix: '/app'
          })
        }
      };


      service = new WebHostService(mockApp, config);

      // Register resources
      service.registerResource('static', new StaticResource(config.resources.static));
      service.registerResource('spa', new SPAResource(config.resources.spa));

      const abortController = new AbortController();
      await service.run(abortController.signal);

      expect(mockApp.serviceOutput).toHaveBeenCalledWith(
        expect.stringContaining('WebHost listening at')
      );
    });

    it('should handle complete authentication flow', () => {
      const config = {
        host: '127.0.0.1',
        port: 3000,
        auth: {
          users: {
            user1: { password: 'pass1', bearerToken: 'token1' },
            user2: { password: 'pass2' },
            user3: { bearerToken: 'token3' }
          }
        }
      };

      registerAuth(mockServer, config.auth);

      expect(mockServer.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function));
    });

    it('should integrate JSON-RPC with complete endpoint', () => {
      const schemas = {
        path: '/api/rpc',
        methods: {
          ping: {
            type: 'query' as const,
            input: z.object({ message: z.string() }),
            result: z.object({ pong: z.string() })
          },
          double: {
            type: 'mutation' as const,
            input: z.object({ number: z.number() }),
            result: z.object({ result: z.number() })
          },
          stream: {
            type: 'stream' as const,
            input: z.object({ count: z.number() }),
            result: z.object({ value: z.number() })
          }
        }
      };

      const implementation = {
        ping: async (args: any, app: any) => ({
          pong: `Hello ${args.message}`
        }),
        double: async (args: any, app: any) => ({
          result: args.number * 2
        }),
        stream: async function* (args: any, app: any, signal: AbortSignal) {
          for (let i = 0; i < args.count; i++) {
            if (signal.aborted) break;
            yield { value: i };
          }
        }
      };

      const endpoint = createRPCEndpoint(schemas, implementation);
      const resource = new JsonRpcResource(mockApp, endpoint);

      expect(endpoint.path).toBe('/api/rpc');
      expect(Object.keys(endpoint.methods)).toHaveLength(3);
      expect(endpoint.methods.ping.type).toBe('query');
      expect(endpoint.methods.double.type).toBe('mutation');
      expect(endpoint.methods.stream.type).toBe('stream');
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle resource registration failures', async () => {
      const config = {
        host: '127.0.0.1',
        port: 3000,
        auth: undefined,
        resources: {}
      };

      service = new WebHostService(mockApp, config);

      const failingResource = {
        register: vi.fn().mockRejectedValue(new Error('Registration failed'))
      };

      service.registerResource('failing', failingResource);

      const abortController = new AbortController();
      
      await expect(service.run(abortController.signal))
        .rejects.toThrow('Registration failed');
    });

    it('should handle auth configuration errors', () => {
      const invalidConfig = {
        host: '127.0.0.1',
        port: 3000,
        auth: {
          invalid: 'config'
        }
      };

      expect(() => new WebHostService(mockApp, invalidConfig)).not.toThrow();
    });

    it('should handle missing resources gracefully', () => {
      const config = {
        host: '127.0.0.1',
        port: 3000,
        auth: undefined,
        resources: undefined
      };

      service = new WebHostService(mockApp, config);
      
      expect(service.getResources()).toEqual({});
    });
  });

  describe('URL Generation Integration', () => {
    it('should generate correct URLs for different configurations', () => {
      const config1 = {
        host: 'localhost',
        port: 8080,
        auth: undefined,
        resources: {}
      };

      const service1 = new WebHostService(mockApp, config1);
      expect(service1.getURL().toString()).toBe('http://localhost:8080/');

      const config2 = {
        host: '0.0.0.0',
        port: 3001,
        auth: undefined,
        resources: {}
      };

      const service2 = new WebHostService(mockApp, config2);
      expect(service2.getURL().toString()).toBe('http://0.0.0.0:3001/');
    });

    it('should handle URL generation when port is not configured', () => {
      const config = {
        host: '127.0.0.1',
        port: undefined,
        auth: undefined,
        resources: {}
      };

      const serviceWithoutPort = new WebHostService(mockApp, config);
      // @ts-ignore
      serviceWithoutPort.server = mockServer;
      mockServer.addresses = vi.fn().mockReturnValue([{ port: 3000 }]);
      
      expect(serviceWithoutPort.getURL().toString()).toBe('http://127.0.0.1:3000/');
    });
  });

  describe('Resource Management Integration', () => {
    it('should manage multiple resources correctly', () => {
      service = new WebHostService(mockApp, {
        host: '127.0.0.1',
        port: 3000,
        auth: undefined,
        resources: {}
      });

      const resource1 = { register: vi.fn() };
      const resource2 = { register: vi.fn() };
      const resource3 = { register: vi.fn() };

      service.registerResource('resource1', resource1);
      service.registerResource('resource2', resource2);
      service.registerResource('resource3', resource3);

      const resources = service.getResources();
      
      expect(Object.keys(resources)).toHaveLength(3);
      expect(resources.resource1).toBe(resource1);
      expect(resources.resource2).toBe(resource2);
      expect(resources.resource3).toBe(resource3);
    });

    it('should handle resource overwriting', () => {
      service = new WebHostService(mockApp, {
        host: '127.0.0.1',
        port: 3000,
        auth: undefined,
        resources: {}
      });

      const resource1 = { register: vi.fn() };
      const resource2 = { register: vi.fn() };

      service.registerResource('same', resource1);
      service.registerResource('same', resource2);

      const resources = service.getResources();
      expect(resources.same).toBe(resource2);
    });
  });

  describe('Configuration Schema Validation', () => {
    it('should validate complete web host configuration', () => {
      const validConfig = {
        host: '127.0.0.1',
        port: 3000,
        auth: {
          users: {
            user1: { password: 'pass1' }
          }
        },
        resources: {
          static: {
            type: 'static' as const,
            root: '/path',
            description: 'Static',
            indexFile: 'index.html',
            prefix: '/static'
          }
        }
      };

      expect(() => new WebHostService(mockApp, validConfig)).not.toThrow();
    });

    it('should handle minimal configuration', () => {
      const minimalConfig = {
        host: '127.0.0.1',
        port: 3000
      };

      expect(() => new WebHostService(mockApp, minimalConfig)).not.toThrow();
    });
  });
});