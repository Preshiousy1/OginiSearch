# Setup Guide

## Prerequisites

- Node.js (v16 or later)
- Docker and Docker Compose
- MongoDB (for development)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/connectsearch.git
cd connectsearch
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

## Development

1. Start the development server:
```bash
npm run start:dev
```

2. Run tests:
```bash
npm test
```

## Performance Testing

The performance test suite measures:
- Query latency (p95 requirements)
- Complex query performance
- Indexing speed
- Memory usage

To run performance tests:

```bash
./scripts/run-performance-tests.sh
```

This script will:
1. Start a MongoDB instance for testing
2. Run performance tests
3. Generate performance reports in `performance-results/`
4. Clean up test resources

The performance reports include:
- HTML report (`performance-results/report.html`)
- Markdown report (`performance-results/report.md`)

## Monitoring

ConnectSearch uses Prometheus and Grafana for monitoring.

### Starting the Monitoring Stack

```bash
docker-compose -f docker-compose.monitoring.yml up -d
```

### Accessing the Dashboard

1. Open http://localhost:3000 in your browser
2. Login with default credentials:
   - Username: admin
   - Password: admin

### Available Metrics

The monitoring dashboard includes:
- Request latency
- Request rate
- Memory usage
- Error rate
- Indexing performance

### Stopping the Monitoring Stack

```bash
docker-compose -f docker-compose.monitoring.yml down
```

## Production Deployment

See [Production Deployment Guide](production-deployment.md) for detailed instructions on deploying to production. 