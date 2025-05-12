# ConnectSearch Production Deployment Guide

This guide provides instructions for deploying ConnectSearch in a production environment.

## Prerequisites

- Docker and Docker Compose installed
- MongoDB instance (version 4.4 or later)
- At least 4GB RAM available
- At least 20GB disk space
- Node.js 16.x or later (for development)

## Production Configuration

### Environment Variables

Create a `.env` file with the following variables:

```bash
# Application
NODE_ENV=production
PORT=3000

# MongoDB
MONGODB_URI=mongodb://your-mongodb-host:27017/connectsearch
MONGODB_USER=your-username
MONGODB_PASSWORD=your-password

# Security
JWT_SECRET=your-secure-jwt-secret
API_KEY=your-api-key

# Performance
MAX_CONNECTIONS=100
REQUEST_TIMEOUT=30000
```

### Docker Compose

Use the provided `docker-compose.yml` for production:

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Monitoring Setup

1. Start the monitoring stack:
```bash
docker-compose -f docker-compose.monitoring.yml up -d
```

2. Access Grafana at `http://localhost:3000` (default credentials: admin/admin)

3. Import the provided dashboard from `monitoring/grafana/dashboards/connectsearch.json`

## Performance Tuning

### MongoDB

- Enable MongoDB authentication
- Configure MongoDB for production:
  ```bash
  mongod --auth --wiredTigerCacheSizeGB 2
  ```

### Application

- Adjust memory limits in Docker:
  ```yaml
  deploy:
    resources:
      limits:
        memory: 2G
  ```

- Configure Node.js for production:
  ```bash
  NODE_OPTIONS="--max-old-space-size=2048"
  ```

## Security Considerations

1. **API Security**
   - Use HTTPS in production
   - Implement rate limiting
   - Use secure API keys

2. **Data Security**
   - Enable MongoDB authentication
   - Use secure passwords
   - Regular backups

3. **Network Security**
   - Configure firewall rules
   - Use internal networks for MongoDB
   - Restrict access to monitoring ports

## Backup and Recovery

### Automated Backups

1. Create a backup script:
```bash
#!/bin/bash
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mongodump --uri="mongodb://your-mongodb-host:27017/connectsearch" --out="$BACKUP_DIR/$DATE"
```

2. Schedule regular backups:
```bash
0 0 * * * /path/to/backup.sh
```

### Recovery Procedure

1. Stop the application
2. Restore MongoDB:
```bash
mongorestore --uri="mongodb://your-mongodb-host:27017/connectsearch" /path/to/backup
```
3. Restart the application

## Scaling

### Vertical Scaling

- Increase MongoDB memory
- Increase application memory
- Use more powerful CPU

### Horizontal Scaling

1. Deploy multiple application instances
2. Use MongoDB replica set
3. Configure load balancer

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Check MongoDB cache size
   - Monitor application memory
   - Adjust batch sizes

2. **Slow Queries**
   - Check MongoDB indexes
   - Monitor query performance
   - Optimize query patterns

3. **Connection Issues**
   - Check network connectivity
   - Verify MongoDB connection
   - Check firewall rules

### Logs

- Application logs: `docker logs connectsearch-app`
- MongoDB logs: `docker logs connectsearch-mongodb`
- Prometheus logs: `docker logs connectsearch-prometheus`

## Maintenance

### Regular Tasks

1. **Daily**
   - Monitor system metrics
   - Check error logs
   - Verify backups

2. **Weekly**
   - Review performance metrics
   - Check disk usage
   - Update security patches

3. **Monthly**
   - Review and update indexes
   - Clean up old backups
   - Update documentation

## Support

For production support:
- Email: support@connectsearch.com
- Documentation: https://docs.connectsearch.com
- GitHub Issues: https://github.com/connectsearch/connectsearch/issues 