# Intelligent Search Engine

A production-ready, intelligent search engine built with NestJS, PostgreSQL, and Redis. Features natural language processing, geographic filtering, and multi-index support.

## 🚀 **Features**

- **Intelligent Search**: Natural language queries with entity extraction
- **Multi-Index Support**: Works with any document type (businesses, listings, etc.)
- **Geographic Filtering**: Location-based search and proximity ranking
- **Performance Optimized**: <200ms response times with Redis + memory caching
- **Fallback Strategy**: Simplified queries when complex ones fail
- **Production Ready**: Clean logging, comprehensive error handling

## 📋 **Quick Start**

### **Prerequisites**
- Node.js 18+
- PostgreSQL 13+
- Redis 6+

### **Installation**
```bash
# Clone the repository
git clone <repository-url>
cd ConnectSearch

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database and Redis credentials

# Start the application
npm run start:dev
```

### **Test the System**
```bash
# Run production tests
npx ts-node scripts/test-production-search.ts
```

## 🔍 **API Usage**

### **Search Documents**
```bash
POST /api/indices/{indexName}/_search
Content-Type: application/json

{
  "query": "restaurants near me",
  "size": 10,
  "userLocation": {
    "lat": 6.5244,
    "lng": 3.3792
  }
}
```

### **Get Suggestions**
```bash
POST /api/indices/{indexName}/_suggest
Content-Type: application/json

{
  "text": "rest",
  "field": "name",
  "size": 5
}
```

## 🏗️ **Architecture**

### **Core Components**
- **SearchService**: Main search orchestration
- **EntityExtractionService**: Business type and service recognition
- **LocationProcessorService**: Geographic query processing
- **QueryExpansionService**: Synonym and related term expansion
- **GeographicFilterService**: Location-based result filtering
- **MultiSignalRankingService**: Advanced result ranking
- **PostgreSQLSearchEngine**: Database search implementation

### **Intelligent Features**
- **Natural Language Processing**: Understands "restaurants near me"
- **Entity Recognition**: Extracts business types, services, locations
- **Query Expansion**: Adds synonyms and related terms
- **Geographic Intelligence**: Location-based filtering and ranking
- **Fallback Strategy**: Simplified queries when complex ones fail

## 📊 **Performance**

- **Response Time**: <200ms for 95% of queries
- **Cache Hit Rate**: >80% with Redis + memory caching
- **Scalability**: Handles 1M+ documents efficiently
- **Multi-Index**: Works across different document types

## 🔧 **Configuration**

### **Environment Variables**
```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=search_engine
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
```

## 📚 **Documentation**

- [Production Deployment Guide](docs/production-deployment-guide.md)
- [API Documentation](docs/api-documentation.md)
- [Configuration Guide](docs/configuration.md)

## 🧪 **Testing**

```bash
# Run unit tests
npm run test

# Run integration tests
npm run test:e2e

# Run production tests
npx ts-node scripts/test-production-search.ts
```

## 🚀 **Deployment**

### **Docker**
```bash
# Build image
docker build -t intelligent-search .

# Run container
docker run -p 3000:3000 intelligent-search
```

### **Production**
See [Production Deployment Guide](docs/production-deployment-guide.md) for detailed instructions.

## 🤝 **Contributing**

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 **License**

This project is licensed under the MIT License.

---

**🎉 Production-ready intelligent search engine for modern applications!**
