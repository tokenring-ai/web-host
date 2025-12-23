import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import SPAResource, { spaResourceConfigSchema } from './SPAResource';
import fs from 'fs/promises';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn()
  },
  access: vi.fn()
}));

vi.mock('path', () => ({
  default: {
    dirname: vi.fn((filePath: string) => filePath.split('/').slice(0, -1).join('/')),
    basename: vi.fn((filePath: string) => filePath.split('/').pop())
  },
  dirname: vi.fn((filePath: string) => filePath.split('/').slice(0, -1).join('/')),
  basename: vi.fn((filePath: string) => filePath.split('/').pop())
}));

vi.mock('@fastify/static', () => ({
  default: vi.fn()
}));

describe('SPAResource', () => {
  let mockServer: FastifyInstance;
  let resource: SPAResource;
  let mockFsAccess: any;

  beforeEach(() => {
    mockServer = {
      register: vi.fn(),
      setNotFoundHandler: vi.fn(),
      plugin: vi.fn()
    };
    mockFsAccess = vi.mocked(fs.access);
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const config = {
        type: 'spa' as const,
        file: '/path/to/app/index.html',
        description: 'SPA application',
        prefix: '/app'
      };

      const resource = new SPAResource(config);
      expect(resource).toBeInstanceOf(SPAResource);
      expect(resource.config).toBe(config);
    });
  });

  describe('register method', () => {
    it('should register SPA with existing file', async () => {
      const config = {
        type: 'spa' as const,
        file: '/path/to/app/index.html',
        description: 'SPA application',
        prefix: '/app'
      };

      const resource = new SPAResource(config);
      await resource.register(mockServer);

      expect(mockFsAccess).toHaveBeenCalledWith('/path/to/app/index.html');
      expect(mockServer.register).toHaveBeenCalledWith(expect.any(Function), { prefix: '/app' });
    });

    it('should handle non-existing file gracefully', async () => {
      const config = {
        type: 'spa' as const,
        file: '/path/to/nonexistent/index.html',
        description: 'SPA application',
        prefix: '/app'
      };

      mockFsAccess.mockRejectedValue(new Error('File not found'));
      
      const resource = new SPAResource(config);
      await resource.register(mockServer);

      expect(mockFsAccess).toHaveBeenCalledWith('/path/to/nonexistent/index.html');
      expect(mockServer.register).toHaveBeenCalledWith(expect.any(Function), { prefix: '/app' });
    });

    it('should serve requests to index.html', async () => {
      const config = {
        type: 'spa' as const,
        file: '/path/to/app/index.html',
        description: 'SPA application',
        prefix: '/app'
      };

      const resource = new SPAResource(config);
      await resource.register(mockServer);

      const registerCall = mockServer.register.mock.calls[0];
      const registerFn = registerCall[0];
      
      expect(typeof registerFn).toBe('function');
      expect(registerCall[1]).toEqual({ prefix: '/app' });
    });

    it('should handle root level file paths', async () => {
      const config = {
        type: 'spa' as const,
        file: 'index.html',
        description: 'Root SPA',
        prefix: '/'
      };

      const resource = new SPAResource(config);
      await resource.register(mockServer);

      expect(mockFsAccess).toHaveBeenCalledWith('index.html');
      expect(mockServer.register).toHaveBeenCalledWith(expect.any(Function), { prefix: '/' });
    });
  });

  describe('spaResourceConfigSchema', () => {
    it('should validate valid config', () => {
      const validConfig = {
        type: 'spa',
        file: '/path/to/app/index.html',
        description: 'SPA application',
        prefix: '/app'
      };

      const result = spaResourceConfigSchema.parse(validConfig);
      expect(result).toEqual(validConfig);
    });

    it('should reject invalid type', () => {
      const invalidConfig = {
        type: 'invalid',
        file: '/path/to/app/index.html',
        description: 'SPA application',
        prefix: '/app'
      };

      expect(() => spaResourceConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should require all required fields', () => {
      const partialConfig = {
        file: '/path/to/app/index.html',
        description: 'SPA application',
        prefix: '/app'
      };

      expect(() => spaResourceConfigSchema.parse(partialConfig)).toThrow();
    });

    it('should validate type discriminator', () => {
      const configWithWrongType = {
        type: 'static' as const,
        file: '/path/to/app/index.html',
        description: 'SPA application',
        prefix: '/app'
      };

      expect(() => spaResourceConfigSchema.parse(configWithWrongType)).toThrow();
    });
  });
});