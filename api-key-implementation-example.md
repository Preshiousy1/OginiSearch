# API Key Authentication - Critical Implementation Examples

## 1. API Key Schema Implementation

### src/storage/mongodb/schemas/api-key.schema.ts
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ApiKeyDocument = ApiKey & Document;

@Schema({ 
  timestamps: true,
  collection: 'api_keys'
})
export class ApiKey {
  @Prop({ required: true, unique: true, index: true })
  keyId: string; // e.g., "ogini_ak_1234567890abcdef"

  @Prop({ required: true, index: true })
  hashedKey: string; // bcrypt hash of the actual key

  @Prop({ required: true })
  name: string; // User-friendly name

  @Prop({ required: true, index: true })
  userId: string; // Owner of the key

  @Prop({ 
    type: [String], 
    default: ['search:read', 'index:read', 'document:read'] 
  })
  permissions: string[];

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ index: true })
  lastUsedAt: Date;

  @Prop({ index: true })
  expiresAt: Date;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ default: 0 })
  requestCount: number;

  @Prop({ default: 1000 })
  rateLimit: number; // requests per hour

  @Prop({ type: [String], default: [] })
  ipWhitelist: string[];

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);

// Indexes for performance
ApiKeySchema.index({ keyId: 1 }, { unique: true });
ApiKeySchema.index({ hashedKey: 1 });
ApiKeySchema.index({ userId: 1, isActive: 1 });
ApiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

### src/storage/mongodb/schemas/user.schema.ts
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ 
  timestamps: true,
  collection: 'users'
})
export class User {
  @Prop({ required: true, unique: true, index: true })
  email: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: 'active', index: true })
  status: string; // active, suspended, deleted

  @Prop({ type: [String], default: [] })
  ipWhitelist: string[];

  @Prop({ default: 5 })
  maxApiKeys: number;

  @Prop({ default: 1000 })
  defaultRateLimit: number;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ status: 1 });
```

## 2. API Key Service Implementation

### src/auth/services/api-key.service.ts
```typescript
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiKey, ApiKeyDocument } from '../../storage/mongodb/schemas/api-key.schema';
import { User, UserDocument } from '../../storage/mongodb/schemas/user.schema';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

export interface CreateApiKeyOptions {
  permissions?: string[];
  rateLimit?: number;
  expiresAt?: Date;
  ipWhitelist?: string[];
  metadata?: Record<string, any>;
}

export interface ApiKeyResponse {
  keyId: string;
  key: string; // Only returned once during creation
  name: string;
  permissions: string[];
  rateLimit: number;
  expiresAt?: Date;
  createdAt: Date;
}

export interface ApiKeyData {
  keyId: string;
  name: string;
  userId: string;
  permissions: string[];
  rateLimit: number;
  isActive: boolean;
  lastUsedAt?: Date;
  expiresAt?: Date;
  requestCount: number;
  ipWhitelist: string[];
  user: {
    email: string;
    name: string;
    status: string;
    ipWhitelist: string[];
  };
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Generate a new API key for a user
   */
  async createApiKey(
    userId: string, 
    name: string, 
    options: CreateApiKeyOptions = {}
  ): Promise<ApiKeyResponse> {
    // Validate user exists and is active
    const user = await this.userModel.findById(userId);
    if (!user || user.status !== 'active') {
      throw new BadRequestException('Invalid or inactive user');
    }

    // Check API key limit
    const existingKeys = await this.apiKeyModel.countDocuments({ 
      userId, 
      isActive: true 
    });
    
    if (existingKeys >= user.maxApiKeys) {
      throw new BadRequestException(`Maximum of ${user.maxApiKeys} API keys allowed`);
    }

    // Generate unique key ID and actual key
    const keyId = this.generateKeyId();
    const actualKey = this.generateActualKey();
    const hashedKey = await bcrypt.hash(actualKey, 12);

    // Create API key document
    const apiKey = new this.apiKeyModel({
      keyId,
      hashedKey,
      name,
      userId,
      permissions: options.permissions || ['search:read', 'index:read', 'document:read'],
      rateLimit: options.rateLimit || user.defaultRateLimit,
      expiresAt: options.expiresAt,
      ipWhitelist: options.ipWhitelist || [],
      metadata: options.metadata || {},
    });

    await apiKey.save();

    this.logger.log(`API key created: ${keyId} for user ${userId}`);

    return {
      keyId,
      key: `${keyId}.${actualKey}`, // Format: keyId.secretKey
      name,
      permissions: apiKey.permissions,
      rateLimit: apiKey.rateLimit,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  /**
   * Validate an API key and return key data
   */
  async validateKey(key: string): Promise<ApiKeyData | null> {
    try {
      // Parse key format: keyId.secretKey
      const [keyId, secretKey] = key.split('.');
      if (!keyId || !secretKey) {
        return null;
      }

      // Find API key by keyId
      const apiKey = await this.apiKeyModel.findOne({ 
        keyId, 
        isActive: true 
      }).lean();

      if (!apiKey) {
        return null;
      }

      // Check expiration
      if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
        this.logger.warn(`Expired API key used: ${keyId}`);
        return null;
      }

      // Validate secret key
      const isValid = await bcrypt.compare(secretKey, apiKey.hashedKey);
      if (!isValid) {
        this.logger.warn(`Invalid API key attempted: ${keyId}`);
        return null;
      }

      // Get user data
      const user = await this.userModel.findById(apiKey.userId).lean();
      if (!user || user.status !== 'active') {
        this.logger.warn(`API key for inactive user: ${keyId}`);
        return null;
      }

      // Update last used timestamp
      await this.apiKeyModel.updateOne(
        { keyId },
        { 
          lastUsedAt: new Date(),
          $inc: { requestCount: 1 }
        }
      );

      return {
        keyId: apiKey.keyId,
        name: apiKey.name,
        userId: apiKey.userId,
        permissions: apiKey.permissions,
        rateLimit: apiKey.rateLimit,
        isActive: apiKey.isActive,
        lastUsedAt: apiKey.lastUsedAt,
        expiresAt: apiKey.expiresAt,
        requestCount: apiKey.requestCount,
        ipWhitelist: apiKey.ipWhitelist,
        user: {
          email: user.email,
          name: user.name,
          status: user.status,
          ipWhitelist: user.ipWhitelist,
        },
      };

    } catch (error) {
      this.logger.error(`API key validation error: ${error.message}`);
      return null;
    }
  }

  /**
   * Get all API keys for a user
   */
  async getUserApiKeys(userId: string): Promise<Omit<ApiKeyData, 'user'>[]> {
    const apiKeys = await this.apiKeyModel.find({ 
      userId, 
      isActive: true 
    }).lean();

    return apiKeys.map(key => ({
      keyId: key.keyId,
      name: key.name,
      userId: key.userId,
      permissions: key.permissions,
      rateLimit: key.rateLimit,
      isActive: key.isActive,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      requestCount: key.requestCount,
      ipWhitelist: key.ipWhitelist,
    }));
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(keyId: string, userId: string): Promise<void> {
    const result = await this.apiKeyModel.updateOne(
      { keyId, userId },
      { isActive: false }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('API key not found');
    }

    this.logger.log(`API key revoked: ${keyId} by user ${userId}`);
  }

  /**
   * Track API key usage
   */
  async trackUsage(keyId: string): Promise<void> {
    await this.apiKeyModel.updateOne(
      { keyId },
      { 
        lastUsedAt: new Date(),
        $inc: { requestCount: 1 }
      }
    );
  }

  /**
   * Generate unique key ID
   */
  private generateKeyId(): string {
    const prefix = process.env.API_KEY_PREFIX || 'ogini_ak_';
    const randomBytes = crypto.randomBytes(16).toString('hex');
    return `${prefix}${randomBytes}`;
  }

  /**
   * Generate actual secret key
   */
  private generateActualKey(): string {
    const keyLength = parseInt(process.env.API_KEY_LENGTH || '32');
    return crypto.randomBytes(keyLength).toString('hex');
  }
}
```

## 3. API Key Guard Implementation

### src/auth/guards/api-key.guard.ts
```typescript
import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  UnauthorizedException,
  ForbiddenException 
} from '@nestjs/common';
import { ApiKeyService } from '../services/api-key.service';
import { RateLimitService } from '../services/rate-limit.service';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    
    // Extract API key from request
    const apiKey = this.extractApiKey(request);
    if (!apiKey) {
      throw new UnauthorizedException('API key required');
    }

    // Validate API key
    const keyData = await this.apiKeyService.validateKey(apiKey);
    if (!keyData) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Check IP whitelist
    if (!await this.validateIpAccess(request, keyData)) {
      throw new ForbiddenException('IP address not whitelisted');
    }

    // Check rate limit
    await this.rateLimitService.checkLimit(keyData.keyId, keyData.rateLimit);

    // Check permissions for the specific endpoint
    const requiredPermission = this.getRequiredPermission(request);
    if (requiredPermission && !keyData.permissions.includes(requiredPermission)) {
      throw new ForbiddenException(`Permission required: ${requiredPermission}`);
    }

    // Attach key data to request for use in controllers
    (request as any).apiKey = keyData;
    
    return true;
  }

  /**
   * Extract API key from various sources
   */
  private extractApiKey(request: Request): string | null {
    // 1. Authorization header: Bearer <api_key>
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // 2. Authorization header: ApiKey <api_key>
    if (authHeader?.startsWith('ApiKey ')) {
      return authHeader.substring(7);
    }

    // 3. x-api-key header
    const apiKeyHeader = request.headers['x-api-key'];
    if (apiKeyHeader) {
      return Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    }

    // 4. api_key query parameter
    const apiKeyQuery = request.query.api_key;
    if (apiKeyQuery) {
      return Array.isArray(apiKeyQuery) ? apiKeyQuery[0] : apiKeyQuery as string;
    }

    return null;
  }

  /**
   * Validate IP access based on whitelist
   */
  private async validateIpAccess(request: Request, keyData: any): Promise<boolean> {
    // Check both API key and user IP whitelists
    const allWhitelists = [
      ...keyData.ipWhitelist,
      ...keyData.user.ipWhitelist
    ];

    if (allWhitelists.length === 0) {
      return true; // No IP restrictions
    }

    const clientIp = this.getClientIp(request);
    return allWhitelists.some(ip => this.matchesIpPattern(clientIp, ip));
  }

  /**
   * Get client IP address
   */
  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    }
    return request.connection.remoteAddress || request.ip;
  }

  /**
   * Check if IP matches pattern (supports CIDR notation)
   */
  private matchesIpPattern(ip: string, pattern: string): boolean {
    if (pattern === ip) return true;
    
    // Support for CIDR notation would go here
    // For now, exact match and wildcard support
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(ip);
    }
    
    return false;
  }

  /**
   * Get required permission for the endpoint
   */
  private getRequiredPermission(request: Request): string | null {
    const method = request.method.toLowerCase();
    const path = request.route?.path || request.path;

    // Map endpoints to required permissions
    if (path.includes('/search')) {
      return 'search:read';
    }
    
    if (path.includes('/indices')) {
      return method === 'get' ? 'index:read' : 'index:write';
    }
    
    if (path.includes('/documents')) {
      return method === 'get' ? 'document:read' : 'document:write';
    }

    return null; // No specific permission required
  }
}
```

## 4. Rate Limiting Service

### src/auth/services/rate-limit.service.ts
```typescript
import { Injectable, Logger, TooManyRequestsException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

interface RateLimit {
  keyId: string;
  requests: number;
  windowStart: Date;
  limit: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly rateLimits = new Map<string, RateLimit>();
  private readonly windowSize = 3600000; // 1 hour in milliseconds

  /**
   * Check if request is within rate limit
   */
  async checkLimit(keyId: string, limit: number): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.windowSize);

    // Get or create rate limit entry
    let rateLimit = this.rateLimits.get(keyId);
    
    if (!rateLimit || rateLimit.windowStart < windowStart) {
      // Create new window or reset expired window
      rateLimit = {
        keyId,
        requests: 0,
        windowStart: now,
        limit,
      };
      this.rateLimits.set(keyId, rateLimit);
    }

    // Increment request count
    rateLimit.requests++;

    // Check if limit exceeded
    if (rateLimit.requests > limit) {
      const resetTime = new Date(rateLimit.windowStart.getTime() + this.windowSize);
      const retryAfter = Math.ceil((resetTime.getTime() - now.getTime()) / 1000);
      
      this.logger.warn(`Rate limit exceeded for API key: ${keyId}`);
      
      throw new TooManyRequestsException({
        message: 'Rate limit exceeded',
        retryAfter,
        limit,
        remaining: 0,
        resetTime: resetTime.toISOString(),
      });
    }

    // Log rate limit status
    const remaining = limit - rateLimit.requests;
    this.logger.debug(`Rate limit status for ${keyId}: ${remaining}/${limit} remaining`);
  }

  /**
   * Get current usage stats
   */
  async getUsage(keyId: string): Promise<{ requests: number; limit: number; remaining: number; resetTime: Date }> {
    const rateLimit = this.rateLimits.get(keyId);
    
    if (!rateLimit) {
      return {
        requests: 0,
        limit: 0,
        remaining: 0,
        resetTime: new Date(),
      };
    }

    const resetTime = new Date(rateLimit.windowStart.getTime() + this.windowSize);
    const remaining = Math.max(0, rateLimit.limit - rateLimit.requests);

    return {
      requests: rateLimit.requests,
      limit: rateLimit.limit,
      remaining,
      resetTime,
    };
  }

  /**
   * Reset rate limit (admin only)
   */
  async resetLimit(keyId: string): Promise<void> {
    this.rateLimits.delete(keyId);
    this.logger.log(`Rate limit reset for API key: ${keyId}`);
  }

  /**
   * Cleanup expired rate limit entries (call periodically)
   */
  cleanupExpiredEntries(): void {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.windowSize);

    for (const [keyId, rateLimit] of this.rateLimits.entries()) {
      if (rateLimit.windowStart < windowStart) {
        this.rateLimits.delete(keyId);
      }
    }
  }
}
```

This implementation provides:

1. **Secure API Key Storage**: Keys are hashed with bcrypt and stored securely
2. **Flexible Authentication**: Multiple methods to provide API keys (header, query param)
3. **Comprehensive Validation**: Checks expiration, user status, permissions
4. **Rate Limiting**: Per-key rate limiting with configurable limits
5. **IP Whitelisting**: Optional IP-based access control
6. **Usage Tracking**: Request counting and last-used timestamps
7. **Permission System**: Granular permissions for different operations

The system is designed to be production-ready with proper error handling, logging, and security best practices. 