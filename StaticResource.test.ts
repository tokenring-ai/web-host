import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import StaticResource, { staticResourceConfigSchema } from './StaticResource';

// Mock fastify-static
vi.mock('@fastify/static', () => ({
  default: vi.fn()
}));

describe('StaticResource', () => {
  let mockServer: FastifyInstance;
  let resource: StaticResource;

  beforeEach(() => {
    mockServer = {
      register: vi.fn(),
      setNotFoundHandler: vi.fn()
    };
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const config = {
        type: 'static' as const,
        root: '/path/to/static',
        description: 'Static files',
        indexFile: 'index.html',
        notFoundFile: '404.html',
        prefix: '/static'
      };

      const resource = new StaticResource(config);
      expect(resource).toBeInstanceOf(StaticResource);
    });
  });

  describe('register method', () => {
    it('should register static file serving', async () => {
      const config = {
        type: 'static' as const,
        root: '/path/to/static',
        description: 'Static files',
        indexFile: 'index.html',
        notFoundFile: '404.html',
        prefix: '/static'
      };

      const resource = new StaticResource(config);
      await resource.register(mockServer);

      expect(mockServer.register).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          root: '/path/to/static',
          prefix: '/static',
          index: 'index.html'
        })
      );
    });

    it('should set not found handler when notFoundFile is provided', async () => {
      const config = {
        type: 'static' as const,
        root: '/path/to/static',
        description: 'Static files',
        indexFile: 'index.html',
        notFoundFile: '404.html',
        prefix: '/static'
      };

      const resource = new StaticResource(config);
      await resource.register(mockServer);

      expect(mockServer.setNotFoundHandler).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should not set not found handler when notFoundFile is not provided', async () => {
      const config = {
        type: 'static' as const,
        root: '/path/to/static',
        description: 'Static files',
        indexFile: 'index.html',
        prefix: '/static'
      };

      const resource = new StaticResource(config);
      await resource.register(mockServer);

      expect(mockServer.setNotFoundHandler).not.toHaveBeenCalled();
    });
  });

  describe('staticResourceConfigSchema', () => {
    it('should validate valid config', () => {
      const validConfig = {
        type: 'static',
        root: '/path/to/static',
        description: 'Static files',
        indexFile: 'index.html',
        notFoundFile: '404.html',
        prefix: '/static'
      };

      const result = staticResourceConfigSchema.parse(validConfig);
      expect(result).toEqual(validConfig);
    });

    it('should reject invalid config', () => {
      const invalidConfig = {
        type: 'invalid',
        root: '/path/to/static',
        description: 'Static files',
        indexFile: 'index.html',
        prefix: '/static'
      };

      expect(() => staticResourceConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should require all required fields', () => {
      const partialConfig = {
        root: '/path/to/static',
        description: 'Static files',
        indexFile: 'index.html',
        prefix: '/static'
      };

      expect(() => staticResourceConfigSchema.parse(partialConfig)).toThrow();
    });
  });
});