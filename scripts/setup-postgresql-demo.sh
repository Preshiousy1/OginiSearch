#!/bin/bash

# ===================================================
# PostgreSQL Demo Setup Script
# ===================================================

echo "🌟 Setting up PostgreSQL for Ogini Search Engine Demo"
echo "======================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo -e "${RED}❌ PostgreSQL is not installed${NC}"
    echo -e "${YELLOW}💡 Please install PostgreSQL first:${NC}"
    echo "   macOS: brew install postgresql"
    echo "   Ubuntu: sudo apt-get install postgresql postgresql-contrib"
    echo "   Windows: Download from https://www.postgresql.org/download/"
    exit 1
fi

echo -e "${GREEN}✅ PostgreSQL is installed${NC}"

# Check if PostgreSQL is running
if ! pg_isready &> /dev/null; then
    echo -e "${YELLOW}⚠️  PostgreSQL is not running${NC}"
    echo -e "${BLUE}🚀 Starting PostgreSQL...${NC}"
    
    # Try to start PostgreSQL (macOS with Homebrew)
    if command -v brew &> /dev/null; then
        brew services start postgresql
    else
        echo -e "${YELLOW}💡 Please start PostgreSQL manually:${NC}"
        echo "   macOS: brew services start postgresql"
        echo "   Ubuntu: sudo systemctl start postgresql"
        echo "   Windows: Start PostgreSQL service"
        exit 1
    fi
    
    # Wait a moment for PostgreSQL to start
    sleep 2
fi

echo -e "${GREEN}✅ PostgreSQL is running${NC}"

# Set default database credentials
DB_NAME="ogini_search_dev"
DB_USER="postgres"
DB_HOST="localhost"
DB_PORT="5432"

echo -e "${BLUE}🗄️  Creating database: ${DB_NAME}${NC}"

# Create database if it doesn't exist
createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME 2>/dev/null || echo -e "${YELLOW}ℹ️  Database may already exist${NC}"

# Create the search_documents table
echo -e "${BLUE}📋 Creating search_documents table...${NC}"

psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << 'SQL'
-- Create search_documents table if it doesn't exist
CREATE TABLE IF NOT EXISTS search_documents (
    id SERIAL PRIMARY KEY,
    index_name VARCHAR(255) NOT NULL,
    doc_id VARCHAR(255) NOT NULL,
    content JSONB NOT NULL,
    search_vector TSVECTOR NOT NULL,
    field_lengths JSONB DEFAULT '{}',
    boost_factor REAL DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(index_name, doc_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_search_documents_index_name ON search_documents(index_name);
CREATE INDEX IF NOT EXISTS idx_search_documents_search_vector ON search_documents USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_search_documents_content ON search_documents USING GIN(content);

-- Enable pg_trgm extension for better text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Show table info
\d search_documents;

-- Show current data
SELECT COUNT(*) as total_documents, 
       COUNT(DISTINCT index_name) as total_indices 
FROM search_documents;
SQL

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Database setup completed successfully${NC}"
else
    echo -e "${RED}❌ Database setup failed${NC}"
    exit 1
fi

# Create environment file
echo -e "${BLUE}⚙️  Creating environment configuration...${NC}"

cat > .env.demo << 'ENV'
# PostgreSQL Demo Environment Configuration
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Search Engine Configuration
SEARCH_ENGINE=postgresql

# PostgreSQL Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=ogini_search_dev
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_SSL=false

# Redis Configuration (optional)
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# Performance Settings
INDEXING_CONCURRENCY=4
BULK_INDEXING_CONCURRENCY=2
DOC_PROCESSING_CONCURRENCY=3
BULK_BATCH_SIZE=100

# Business Optimizations
BUSINESS_SEARCH_BOOST_FACTOR=1.5
NIGERIAN_BUSINESS_CONTEXT=true
ENABLE_LOCATION_BOOST=true
ENV

echo -e "${GREEN}✅ Environment file created: .env.demo${NC}"

echo ""
echo -e "${GREEN}🎉 PostgreSQL Demo Setup Complete!${NC}"
echo ""
echo -e "${BLUE}📋 Next Steps:${NC}"
echo "   1. Copy environment: cp .env.demo .env"
echo "   2. Install dependencies: npm install"
echo "   3. Run demo: npm run ts-node scripts/demo-postgresql-search.ts"
echo "   4. Or start the server: npm start"
echo ""
echo -e "${YELLOW}💡 Database Details:${NC}"
echo "   Host: $DB_HOST:$DB_PORT"
echo "   Database: $DB_NAME"
echo "   User: $DB_USER"
echo "   Tables: search_documents"
echo ""
echo -e "${BLUE}🔍 Test API Endpoints:${NC}"
echo "   POST http://localhost:3000/api/indices/test/_search"
echo "   POST http://localhost:3000/api/indices"
echo ""
