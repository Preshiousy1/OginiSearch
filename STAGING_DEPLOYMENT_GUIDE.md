# 🚀 Ogini Search - Staging Deployment Guide

## 📋 Pre-Deployment Checklist

### ✅ Files Updated for Production
- `docker-compose.prod.yml` - Added PgBouncer service and updated all services to use PgBouncer
- `Dockerfile` - Added config folder copy for PgBouncer configuration
- `config/pgbouncer.ini` - Optimized PgBouncer configuration
- `config/userlist.txt` - PgBouncer authentication file
- `scripts/init-clean-postgres.sql` - Clean database initialization script

### ✅ Optimizations Applied
- **Generic search engine** - No hardcoded index-specific logic
- **PgBouncer connection pooling** - 20 default pool size, 10 min pool
- **Redis caching** - Dual-layer caching (Redis + Memory)
- **Multi-word query optimization** - 2-3 word queries use simple text search
- **Clean PostgreSQL logs** - No more SET LOCAL warnings

## 🚀 Deployment Steps

### 1. Deploy to Railway
```bash
# Push your changes to the staging branch
git push origin staging

# Railway will automatically deploy using docker-compose.prod.yml
```

### 2. Wait for Services to be Healthy
Monitor the Railway dashboard to ensure all services are running:
- `app` - Main application
- `pgbouncer` - Connection pooling
- `postgres` - Database
- `redis` - Cache
- `worker-1` through `worker-6` - Indexing workers

### 3. Initialize Clean Database
Once all services are healthy, call the database initialization endpoint:

```bash
# Replace with your actual Railway staging URL
curl -X GET "https://your-staging-url.railway.app/debug/init-clean-database"
```

**Expected Response:**
```json
{
  "status": "success",
  "message": "Clean database initialization completed",
  "timestamp": "2025-08-23T19:45:00.000Z"
}
```

### 4. Verify Database Initialization
Check that the database is properly initialized:

```bash
# Test a simple search to verify everything is working
curl -X POST "https://your-staging-url.railway.app/api/indices/businesses/_search" \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "size": 5}'
```

## 🔧 PgBouncer Configuration

### Connection Pooling Settings
- **Default pool size**: 20 connections
- **Minimum pool size**: 10 connections
- **Reserve pool size**: 10 connections
- **Max client connections**: 100
- **Max database connections**: 50

### Performance Optimizations
- **Pool mode**: Transaction (safest for search workloads)
- **Server lifetime**: 1800s (30 minutes)
- **Server idle timeout**: 300s (5 minutes)
- **Query timeout**: 0 (no timeout)

## 📊 Expected Performance

### Search Response Times
| Query Type | Performance | Notes |
|------------|-------------|-------|
| **Single words** | 13-177ms | Excellent |
| **Multi-word (2-3)** | 30-87ms | Optimized |
| **Complex phrases** | 220-813ms | Full-text search |
| **Cached queries** | 4ms | Lightning fast |

### Database Layer
- **Connection pooling**: PgBouncer with 20-50 connections
- **Query optimization**: Generic multi-word optimization
- **Caching**: Redis + Memory dual-layer
- **Indexing**: 6 dedicated worker processes

## 🔍 Monitoring & Debugging

### Health Check Endpoints
```bash
# Application health
GET /health

# Database health
GET /debug/health/businesses

# Test search
GET /debug/test-search/businesses/hotel
```

### PgBouncer Statistics
```bash
# Connect to PgBouncer admin interface
psql -h localhost -p 6432 -U postgres -d pgbouncer

# View pool statistics
SHOW POOLS;

# View connection statistics
SHOW STATS;
```

## 🚨 Troubleshooting

### Common Issues

1. **PgBouncer Connection Issues**
   - Check if config files are properly mounted
   - Verify authentication in `config/userlist.txt`
   - Check PgBouncer logs: `docker logs ogini-pgbouncer-prod`

2. **Database Initialization Fails**
   - Ensure `scripts/init-clean-postgres.sql` exists
   - Check PostgreSQL logs for errors
   - Verify database permissions

3. **Performance Issues**
   - Check PgBouncer pool utilization
   - Monitor Redis cache hit rates
   - Verify worker processes are running

### Log Locations
- **Application**: Railway logs or `docker logs ogini-dev-app-1`
- **PgBouncer**: `docker logs ogini-pgbouncer-prod`
- **PostgreSQL**: `docker logs ogini-postgres-prod`
- **Redis**: `docker logs ogini-redis-prod`

## 📝 Post-Deployment Checklist

- [ ] All services are healthy in Railway dashboard
- [ ] Database initialization completed successfully
- [ ] Test search returns results in expected time range
- [ ] PgBouncer is processing queries (check stats)
- [ ] Redis cache is working (check cache hit rates)
- [ ] Worker processes are running and processing jobs
- [ ] No PostgreSQL warnings in logs
- [ ] Performance meets expectations (13-177ms for single words)

## 🎯 Ready for Bulk Indexing

Once the database is initialized and verified, you can proceed with bulk indexing:

```bash
# Bulk index documents
POST /api/indices/businesses/documents/_bulk
Content-Type: application/json

{
  "documents": [
    {"id": "1", "document": {...}},
    {"id": "2", "document": {...}}
  ]
}
```

The system is now optimized and ready for production-scale indexing and search operations! 🚀 