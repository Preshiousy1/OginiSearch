# Ogini

A powerful search engine with Nigerian roots, built with NestJS and TypeScript.

## Features

- Full-text search with advanced query capabilities
- Real-time indexing and search
- Faceted search and filtering
- Geospatial search support
- Multi-language support
- RESTful API
- TypeScript client library
- Docker support
- Monitoring with Prometheus and Grafana
- **Memory-optimized architecture** with 97% memory reduction

## Quick Start

### Using Docker

```bash
# Development
npm run docker:dev

# Production
npm run docker:prod
```

### Manual Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
```

3. Start the development server:
```bash
npm run start:dev
```

## Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- **[📚 Main Documentation](docs/README.md)** - Complete documentation index
- **[🐛 Bug Fixes](docs/bug-fixes/)** - Major bug fixes and optimizations
- **[🔧 Scripts](scripts/README.md)** - Utility scripts for development and deployment

### Recent Updates
- **Memory Optimization** (May 2025): Resolved critical memory leaks, achieving 97% memory reduction and production stability

## API Documentation

The API documentation is available at `/api` when running the server.

## Client Library

We provide a TypeScript client library for easy integration:

```bash
npm install @ogini/client
```

Example usage:

```typescript
import { Ogini } from '@ogini/client';

const client = new Ogini({
  baseURL: 'http://localhost:3000',
});

// Create an index
await client.indices.createIndex({
  name: 'products',
  mappings: {
    properties: {
      title: { type: 'text' },
      price: { type: 'float' }
    }
  }
});

// Search
const results = await client.search.search('products', {
  query: {
    match: {
      field: 'title',
      value: 'nike'
    }
  }
});
```

For more details, see the [client documentation](packages/client/README.md).

## Architecture

Ogini is built with a modular architecture:

- **API Layer**: NestJS REST API
- **Search Engine**: Custom implementation with RocksDB
- **Storage**: MongoDB for metadata
- **Client**: TypeScript client library
- **Monitoring**: Prometheus and Grafana

## Development

### Prerequisites

- Node.js 18+
- MongoDB 7+
- Docker (optional)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/ogini/ogini.git
cd ogini
```

2. Install dependencies:
```bash
npm install
```

3. Start development server:
```bash
npm run start:dev
```

### Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

### Docker Development

```bash
# Start development environment
npm run docker:dev

# View logs
npm run docker:logs

# Stop containers
npm run docker:down
```

## Monitoring

The application includes Prometheus metrics and Grafana dashboards:

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000/grafana

## Contributing

Contributions are welcome! Please read our [contributing guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
