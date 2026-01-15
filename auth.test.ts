import {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AuthConfigSchema, registerAuth} from './auth';

describe('auth', () => {
  let mockServer: FastifyInstance;
  let mockRequest: FastifyRequest;
  let mockReply: FastifyReply;

  beforeEach(() => {
    mockServer = {
      addHook: vi.fn()
    } as any;
    mockRequest = {
      headers: {}
    } as any;
    mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis()
    } as any;
  });

  describe('AuthConfigSchema', () => {
    it('should validate valid config', () => {
      const validConfig = {
        users: {
          user1: {
            password: 'password1',
            bearerToken: 'token1'
          },
          user2: {
            password: 'password2'
          }
        }
      };

      const result = AuthConfigSchema.parse(validConfig);
      expect(result).toEqual(validConfig);
    });

    it('should reject invalid config', () => {
      const invalidConfig = {
        users: {
          user1: {
            password: 123
          }
        }
      };

      expect(() => AuthConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should require users field', () => {
      const incompleteConfig = {};

      expect(() => AuthConfigSchema.parse(incompleteConfig)).toThrow();
    });
  });

  describe('registerAuth', () => {
    let config: any;

    beforeEach(() => {
      config = {
        users: {
          user1: {
            password: 'password1',
            bearerToken: 'token1'
          },
          user2: {
            password: 'password2'
          },
          user3: {
            bearerToken: 'token3'
          }
        }
      };
    });

    it('should register onRequest hook', () => {
      registerAuth(mockServer, config);

      expect(mockServer.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function));
    });

    it('should reject request without authorization header', async () => {
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should accept valid bearer token', async () => {
      mockRequest.headers.authorization = 'Bearer token1';
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockRequest.user).toBe('user1');
    });

    it('should reject invalid bearer token', async () => {
      mockRequest.headers.authorization = 'Bearer invalid_token';
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should accept valid basic auth credentials', async () => {
      const encoded = Buffer.from('user1:password1').toString('base64');
      mockRequest.headers.authorization = `Basic ${encoded}`;
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockRequest.user).toBe('user1');
    });

    it('should reject invalid basic auth credentials', async () => {
      const encoded = Buffer.from('user1:wrongpassword').toString('base64');
      mockRequest.headers.authorization = `Basic ${encoded}`;
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should reject malformed basic auth', async () => {
      const encoded = Buffer.from('malformed').toString('base64');
      mockRequest.headers.authorization = `Basic ${encoded}`;
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should reject basic auth with missing password', async () => {
      const encoded = Buffer.from('user1').toString('base64');
      mockRequest.headers.authorization = `Basic ${encoded}`;
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should handle user with only bearer token', async () => {
      mockRequest.headers.authorization = 'Bearer token3';
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockRequest.user).toBe('user3');
    });

    it('should handle user with only password', async () => {
      const encoded = Buffer.from('user2:password2').toString('base64');
      mockRequest.headers.authorization = `Basic ${encoded}`;
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockRequest.user).toBe('user2');
    });

    it('should reject bearer token for user without token', async () => {
      mockRequest.headers.authorization = 'Bearer token1';
      
      const configWithoutToken = {
        users: {
          user1: { password: 'password1' }
        }
      };
      registerAuth(mockServer, configWithoutToken);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should handle case sensitivity in authorization header', async () => {
      mockRequest.headers.authorization = 'bearer token1';
      registerAuth(mockServer, config);

      const onRequestCallback = mockServer.addHook.mock.calls[0][1];
      await onRequestCallback(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });
  });
});