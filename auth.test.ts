import {beforeEach, describe, expect, it, vi} from 'vitest';
import {checkAuth, unauthorizedResponse} from './auth';
import {AuthConfigSchema} from "./schema";
import {BunRequest, BunResponse, BunRouter} from './types';

describe('auth', () => {
  let mockRouter: BunRouter;
  let mockRequest: Partial<BunRequest>;
  let mockResponse: Partial<BunResponse>;

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
    
    mockRequest = {
      headers: new Headers()
    };
    
    mockResponse = {
      json: vi.fn((data, status = 200) => {
        return new Response(JSON.stringify(data), {
          status,
          headers: {"Content-Type": "application/json"}
        });
      })
    };
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
  });

  describe('checkAuth', () => {
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

    it('should reject request without authorization header', () => {
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBeNull();
    });

    it('should accept valid bearer token', () => {
      mockRequest.headers = new Headers({
        'authorization': 'Bearer token1'
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBe('user1');
    });

    it('should reject invalid bearer token', () => {
      mockRequest.headers = new Headers({
        'authorization': 'Bearer invalid_token'
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBeNull();
    });

    it('should accept valid basic auth credentials', () => {
      const encoded = Buffer.from('user1:password1').toString('base64');
      mockRequest.headers = new Headers({
        'authorization': `Basic ${encoded}`
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBe('user1');
    });

    it('should reject invalid basic auth credentials', () => {
      const encoded = Buffer.from('user1:wrongpassword').toString('base64');
      mockRequest.headers = new Headers({
        'authorization': `Basic ${encoded}`
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBeNull();
    });

    it('should reject malformed basic auth', () => {
      const encoded = Buffer.from('malformed').toString('base64');
      mockRequest.headers = new Headers({
        'authorization': `Basic ${encoded}`
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBeNull();
    });

    it('should reject basic auth with missing password', () => {
      const encoded = Buffer.from('user1').toString('base64');
      mockRequest.headers = new Headers({
        'authorization': `Basic ${encoded}`
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBeNull();
    });

    it('should handle user with only bearer token', () => {
      mockRequest.headers = new Headers({
        'authorization': 'Bearer token3'
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBe('user3');
    });

    it('should handle user with only password', () => {
      const encoded = Buffer.from('user2:password2').toString('base64');
      mockRequest.headers = new Headers({
        'authorization': `Basic ${encoded}`
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBe('user2');
    });

    it('should reject bearer token for user without token', () => {
      mockRequest.headers = new Headers({
        'authorization': 'Bearer token1'
      });
      
      const configWithoutToken = {
        users: {
          user1: { password: 'password1' }
        }
      };
      
      const result = checkAuth(mockRequest as BunRequest, configWithoutToken);
      expect(result).toBeNull();
    });

    it('should handle case sensitivity in authorization header', () => {
      mockRequest.headers = new Headers({
        'authorization': 'bearer token1'
      });
      
      const result = checkAuth(mockRequest as BunRequest, config);
      expect(result).toBeNull();
    });
  });

  describe('unauthorizedResponse', () => {
    it('should return 401 response', () => {
      const response = unauthorizedResponse(mockResponse as BunResponse);
      
      expect(mockResponse.json).toHaveBeenCalledWith(
        {error: "Unauthorized"},
        401
      );
    });
  });
});
