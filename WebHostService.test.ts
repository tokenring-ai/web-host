import TokenRingApp from '@tokenring-ai/app';
import createTestingApp from '@tokenring-ai/app/test/createTestingApp';
import Fastify, {FastifyInstance} from 'fastify';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WebResource} from './types';
import WebHostService from './WebHostService';

vi.mock('@tokenring-ai/utility/promise/waitForAbort', () => ({
  default: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('fastify', () => ({
  default: vi.fn()
}));

describe('WebHostService', () => {
  let service: WebHostService;
  let mockApp: TokenRingApp;
  let mockConfig: any;
  let mockServer: FastifyInstance;

  beforeEach(() => {
    mockApp = createTestingApp();
    mockServer = {
      register: vi.fn(),
      setNotFoundHandler: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      addresses: vi.fn(() => [{ port: 3000 }]),
      printRoutes: vi.fn(() => 'Routes'),
      logger: false,
      routerOptions: { ignoreTrailingSlash: true },
      addHook: vi.fn()
    } as any;
    vi.mocked(Fastify).mockReturnValue(mockServer);

    mockConfig = {
      host: '127.0.0.1',
      port: 3000,
      auth: undefined,
      resources: {}
    };
    service = new WebHostService(mockApp, mockConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct properties', () => {
      expect(service.name).toBe('WebHostService');
      expect(service.description).toBe('Fastify web host for serving resources and APIs');
    });

    it('should initialize resources registry', () => {
      expect(service.resources).toBeDefined();
      expect(service.registerResource).toBeDefined();
      expect(service.getResources).toBeDefined();
    });
  });

  describe('run method', () => {
    beforeEach(() => {
      vi.spyOn(mockApp, 'serviceOutput');
    });

    it('should create server and configure auth when provided', async () => {
      const configWithAuth = {
        ...mockConfig,
        auth: {
          users: {
            testuser: { password: 'testpass' }
          }
        }
      };
      
      const serviceWithAuth = new WebHostService(mockApp, configWithAuth);
      
      const abortController = new AbortController();
      abortController.abort();
      
      await expect(serviceWithAuth.run(abortController.signal)).resolves.not.toThrow();
    });

    it('should handle server startup errors', async () => {
      const error = new Error('Server startup failed');
      mockServer.listen = vi.fn().mockRejectedValue(error);
      
      const abortController = new AbortController();
      
      await expect(service.run(abortController.signal)).rejects.toThrow('Server startup failed');
    });

    it('should register resources', async () => {
      const mockResource: WebResource = {
        register: vi.fn()
      };
      
      service.registerResource('test', mockResource);
      
      const abortController = new AbortController();
      abortController.abort();
      
      await service.run(abortController.signal);
      
      expect(mockResource.register).toHaveBeenCalled();
    });

    it('should log URL when started', async () => {
      const abortController = new AbortController();
      abortController.abort();
      
      await service.run(abortController.signal);
      
      expect(mockApp.serviceOutput).toHaveBeenCalledWith(expect.stringContaining('WebHost listening at'));
    });
  });

  describe('getURL method', () => {
    it('should return URL when port is configured', () => {
      const url = service.getURL();
      expect(url.toString()).toBe('http://127.0.0.1:3000/');
    });

    it('should throw error when server is not started and no port configured', async () => {
      const configWithoutPort = {
        ...mockConfig,
        port: undefined
      };
      
      const serviceWithoutPort = new WebHostService(mockApp, configWithoutPort);
      // @ts-ignore
      serviceWithoutPort.server = { addresses: () => [] };
      
      expect(() => serviceWithoutPort.getURL()).toThrow('Failed to get port');
    });
  });

  describe('resource registration', () => {
    it('should register and retrieve resources', () => {
      const mockResource: WebResource = {
        register: vi.fn()
      };
      
      service.registerResource('test', mockResource);
      const resources = service.getResources();
      
      expect(resources.test).toBe(mockResource);
    });

    it('should handle multiple resources', () => {
      const resource1: WebResource = { register: vi.fn() };
      const resource2: WebResource = { register: vi.fn() };
      
      service.registerResource('resource1', resource1);
      service.registerResource('resource2', resource2);
      
      const resources = service.getResources();
      
      expect(Object.keys(resources)).toHaveLength(2);
      expect(resources.resource1).toBe(resource1);
      expect(resources.resource2).toBe(resource2);
    });
  });
});