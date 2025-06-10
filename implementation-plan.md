# API Key Authentication Feature Implementation Plan

## Overview
Implement a comprehensive API key authentication system for the Ogini search engine that allows users to generate and manage unique API keys for their applications.

## Current State Analysis

### Existing Infrastructure
- ✅ NestJS application with Swagger documentation
- ✅ JWT Bearer auth decorators on all controllers  
- ✅ MongoDB storage with schemas (index, document, term-postings)
- ✅ RESTful API endpoints for search, indexing, document management
- ✅ Configuration management with @nestjs/config
- ✅ Laravel Scout driver accepts OGINI_API_KEY

### Missing Components
- ❌ Authentication guards/middleware implementation
- ❌ API key storage and management system
- ❌ User/client management system
- ❌ Rate limiting per API key
- ❌ API key validation logic

## Implementation Phases

### Phase 1: Core Authentication Infrastructure

#### 1.1 Database Schema & Models

**Create API Key Schema** (`src/storage/mongodb/schemas/api-key.schema.ts`)
```typescript
@Schema({ timestamps: true })
export class ApiKey {
  @Prop({ required: true, unique: true })
  keyId: string; // e.g., "ogini_ak_1234567890abcdef"

  @Prop({ required: true })
  hashedKey: string; // bcrypt hash of the actual key

  @Prop({ required: true })
  name: string; // User-friendly name

  @Prop({ required: true })
  userId: string; // Owner of the key

  @Prop({ type: [String], default: ['read', 'write'] })
  permissions: string[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastUsedAt: Date;

  @Prop()
  expiresAt: Date;

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ default: 0 })
  requestCount: number;

  @Prop({ default: 1000 })
  rateLimit: number; // requests per hour
}
```

**Create User Schema** (`src/storage/mongodb/schemas/user.schema.ts`)
```typescript
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: 'active' })
  status: string;

  @Prop({ type: [String], default: [] })
  ipWhitelist: string[];

  @Prop({ default: 5 })
  maxApiKeys: number;
}
```

#### 1.2 Authentication Guards & Middleware

**API Key Guard** (`src/auth/guards/api-key.guard.ts`)
```typescript
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);
    
    if (!apiKey) {
      throw new UnauthorizedException('API key required');
    }

    const keyData = await this.apiKeyService.validateKey(apiKey);
    if (!keyData) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Rate limiting check
    await this.rateLimitService.checkLimit(keyData.keyId);
    
    // Attach key data to request
    request.apiKey = keyData;
    
    return true;
  }

  private extractApiKey(request: any): string | null {
    // Support multiple auth methods:
    // 1. Authorization: Bearer <api_key>
    // 2. Authorization: ApiKey <api_key>  
    // 3. x-api-key header
    // 4. api_key query parameter
  }
}
```

#### 1.3 Core Services

**API Key Service** (`src/auth/services/api-key.service.ts`)
```typescript
@Injectable()
export class ApiKeyService {
  // Generate new API key
  async createApiKey(userId: string, name: string, options?: CreateApiKeyOptions): Promise<ApiKeyResponse>
  
  // Validate API key
  async validateKey(key: string): Promise<ApiKeyData | null>
  
  // List user's API keys
  async getUserApiKeys(userId: string): Promise<ApiKeyData[]>
  
  // Revoke API key
  async revokeApiKey(keyId: string, userId: string): Promise<void>
  
  // Update API key permissions
  async updateApiKey(keyId: string, updates: UpdateApiKeyDto): Promise<ApiKeyData>
  
  // Track API key usage
  async trackUsage(keyId: string): Promise<void>
}
```

### Phase 2: API Management Endpoints

#### 2.1 Authentication Controller

**Auth Controller** (`src/auth/controllers/auth.controller.ts`)
```typescript
@Controller('api/auth')
@ApiTags('Authentication')
export class AuthController {
  
  @Post('keys')
  @ApiOperation({ summary: 'Generate new API key' })
  async createApiKey(@Body() createDto: CreateApiKeyDto): Promise<ApiKeyResponse>
  
  @Get('keys')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'List API keys' })
  async getApiKeys(): Promise<ApiKeyData[]>
  
  @Delete('keys/:keyId')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Revoke API key' })
  async revokeApiKey(@Param('keyId') keyId: string): Promise<void>
  
  @Patch('keys/:keyId')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Update API key' })
  async updateApiKey(@Param('keyId') keyId: string, @Body() updateDto: UpdateApiKeyDto): Promise<ApiKeyData>
  
  @Get('keys/:keyId/usage')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Get API key usage statistics' })
  async getKeyUsage(@Param('keyId') keyId: string): Promise<UsageStats>
}
```

### Phase 3: Enhanced Security Features

#### 3.1 Rate Limiting Service

**Rate Limit Service** (`src/auth/services/rate-limit.service.ts`)
```typescript
@Injectable()
export class RateLimitService {
  // Check if request is within rate limit
  async checkLimit(keyId: string): Promise<void>
  
  // Get current usage stats
  async getUsage(keyId: string): Promise<RateLimit>
  
  // Reset rate limit (admin only)
  async resetLimit(keyId: string): Promise<void>
}
```

#### 3.2 IP Whitelisting

Add IP validation to the ApiKeyGuard:
```typescript
private async validateIpAccess(request: any, keyData: ApiKeyData): Promise<boolean> {
  if (keyData.user.ipWhitelist.length === 0) return true;
  
  const clientIp = this.getClientIp(request);
  return keyData.user.ipWhitelist.some(ip => this.matchesIpPattern(clientIp, ip));
}
```

### Phase 4: User Management & Dashboard

#### 4.1 User Management

**User Service** (`src/auth/services/user.service.ts`)
```typescript
@Injectable()
export class UserService {
  // Create user account
  async createUser(createDto: CreateUserDto): Promise<User>
  
  // Get user by ID/email
  async getUser(identifier: string): Promise<User>
  
  // Update user settings
  async updateUser(userId: string, updateDto: UpdateUserDto): Promise<User>
  
  // Delete user and all associated API keys
  async deleteUser(userId: string): Promise<void>
}
```

#### 4.2 Admin Dashboard Endpoints

**Admin Controller** (`src/auth/controllers/admin.controller.ts`)
```typescript
@Controller('api/admin')
@ApiTags('Administration')
@UseGuards(AdminGuard)
export class AdminController {
  
  @Get('users')
  async getAllUsers(): Promise<User[]>
  
  @Get('keys')
  async getAllApiKeys(): Promise<ApiKeyData[]>
  
  @Post('users/:userId/keys/:keyId/revoke')
  async revokeUserApiKey(@Param('userId') userId: string, @Param('keyId') keyId: string): Promise<void>
  
  @Get('analytics/usage')
  async getUsageAnalytics(): Promise<UsageAnalytics>
}
```

### Phase 5: Integration & Testing

#### 5.1 Update Existing Controllers

Apply `@UseGuards(ApiKeyGuard)` to all controllers:
```typescript
// src/api/controllers/search.controller.ts
@Controller('api/indices/:index/_search')
@UseGuards(ApiKeyGuard)
@ApiTags('Search')
export class SearchController {
  // ... existing methods
}
```

#### 5.2 Middleware Integration

```typescript
// src/auth/middleware/api-key.middleware.ts
@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    // Add request ID, logging, etc.
    next();
  }
}
```

#### 5.3 Testing Strategy

**Unit Tests:**
- API key generation and validation
- Rate limiting logic
- IP whitelisting
- User management

**Integration Tests:**
- End-to-end API key authentication flow
- Rate limiting enforcement
- Permission validation

## Required Dependencies

Add to package.json:
```json
{
  "dependencies": {
    "bcrypt": "^5.1.0",
    "@types/bcrypt": "^5.0.0",
    "crypto": "built-in",
    "express-rate-limit": "^6.0.0"
  }
}
```

## Configuration

Add to environment variables:
```bash
# API Key Configuration
API_KEY_PREFIX=ogini_ak_
API_KEY_LENGTH=32
API_KEY_HASH_ROUNDS=12

# Rate Limiting
DEFAULT_RATE_LIMIT=1000
RATE_LIMIT_WINDOW=3600

# Security
REQUIRE_IP_WHITELIST=false
MAX_API_KEYS_PER_USER=5
```

## Deployment Considerations

1. **Database Migration:** Create indexes for API key lookups
2. **Backward Compatibility:** Support existing JWT tokens during transition
3. **Monitoring:** Add logging for authentication events
4. **Documentation:** Update Swagger with API key authentication examples

## Success Metrics

- ✅ API key generation and validation working
- ✅ Rate limiting enforced per key
- ✅ User management system functional
- ✅ All existing endpoints protected
- ✅ Laravel Scout driver integration working
- ✅ Performance: < 10ms authentication overhead
- ✅ Documentation updated with examples

## Timeline Estimate

- **Phase 1:** 3-4 days (Core infrastructure)
- **Phase 2:** 2-3 days (API endpoints)
- **Phase 3:** 2-3 days (Security features)
- **Phase 4:** 2-3 days (User management)
- **Phase 5:** 2-3 days (Integration & testing)

**Total: ~12-16 days** 