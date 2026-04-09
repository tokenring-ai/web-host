import {beforeEach, describe, expect, it, vi} from 'vitest';
import SPAResource, {spaResourceConfigSchema} from './SPAResource';
import {BunRouter} from './types';

// Mock Bun.file
vi.mock('bun', () => ({
  file: vi.fn(() => ({
    exists: vi.fn().mockResolvedValue(true)
  }))
}));

describe('SPAResource', () => {
  let mockRouter: BunRouter;
  let resource: SPAResource;

  beforeEach(() => {
    mockRouter = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      ws: vi.fn(),
      static: vi.fn(),
      fallback: vi.fn()
    };
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const config = {
        type: 'spa' as const,
        file: '/path/to/index.html',
        description: 'SPA Application',
        prefix: '/app'
      };

      const resource = new SPAResource(config);
      expect(resource).toBeInstanceOf(SPAResource);
    });
  });

  describe('register method', () => {
    it('should register SPA with existing file', async () => {
      const config = {
        type: 'spa' as const,
        file: '/path/to/index.html',
        description: 'SPA Application',
        prefix: '/app'
      };

      const resource = new SPAResource(config);
      await resource.register(mockRouter);

      // Should register static file serving
      expect(mockRouter.static).toHaveBeenCalledWith('/app', '/path/to');
      
      // Should register GET handlers for root paths
      expect(mockRouter.get).toHaveBeenCalledWith('/app', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/app/', expect.any(Function));
      
      // Should register fallback handler
      expect(mockRouter.fallback).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should handle root level file paths', async () => {
      const config = {
        type: 'spa' as const,
        file: '/index.html',
        description: 'SPA Application',
        prefix: '/'
      };

      const resource = new SPAResource(config);
      await resource.register(mockRouter);

      // Should register static file serving with root directory
      expect(mockRouter.static).toHaveBeenCalled();
    });

    it('should serve requests to index.html', async () => {
      const config = {
        type: 'spa' as const,
        file: '/path/to/index.html',
        description: 'SPA Application',
        prefix: '/app'
      };

      const resource = new SPAResource(config);
      await resource.register(mockRouter);

      // Get the handler for /app
      const rootHandler = (mockRouter.get as any).mock.calls.find(
        (call: any[]) => call[0] === '/app'
      )[1];

      const mockRequest: any = {
        method: 'GET',
        url: 'http://localhost/app',
        path: '/app',
        headers: new Headers()
      };

      const mockResponse: any = {
        file: vi.fn().mockResolvedValue(new Response('HTML content'))
      };

      await rootHandler(mockRequest, mockResponse);

      expect(mockResponse.file).toHaveBeenCalledWith('/path/to/index.html');
    });
  });

  describe('spaResourceConfigSchema', () => {
    it('should validate valid config', () => {
      const validConfig = {
        type: 'spa',
        file: '/path/to/index.html',
        description: 'SPA Application',
        prefix: '/app'
      };

      const result = spaResourceConfigSchema.parse(validConfig);
      expect(result).toEqual(validConfig);
    });

    it('should reject invalid type', () => {
      const invalidConfig = {
        type: 'invalid',
        file: '/path/to/index.html',
        description: 'SPA Application',
        prefix: '/app'
      };

      expect(() => spaResourceConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should require all required fields', () => {
      const partialConfig = {
        file: '/path/to/index.html',
        description: 'SPA Application',
        prefix: '/app'
      };

      expect(() => spaResourceConfigSchema.parse(partialConfig)).toThrow();
    });

    it('should validate type discriminator', () => {
      const config = {
        type: 'spa',
        file: '/path/to/index.html',
        description: 'SPA Application',
        prefix: '/app'
      };

      const result = spaResourceConfigSchema.parse(config);
      expect(result.type).toBe('spa');
    });
  });
});
