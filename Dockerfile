# Stage 1: Build stage
FROM node:20-alpine AS build

WORKDIR /usr/src/app

# Install build dependencies for native modules with specific versions
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    linux-headers \
    bash

# Set Python path for node-gyp
ENV PYTHON=/usr/bin/python3
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy package files first for better caching
COPY package*.json ./

# Try to install dependencies with fallback for rocksdb
RUN npm ci || \
    (echo "Native module build failed, installing without optional dependencies" && \
    npm ci --no-optional)

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production stage
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV DOCKER=true

WORKDIR /usr/src/app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates bash

# Copy package files
COPY package*.json ./

# Install only production dependencies with fallback
RUN npm ci --only=production --no-optional || \
    (echo "Installing production dependencies without native modules" && \
    npm ci --only=production --no-optional)

# Copy built application from build stage
COPY --from=build /usr/src/app/dist ./dist

# Copy scripts folder for SQL migrations
COPY --from=build /usr/src/app/scripts ./scripts

# Copy config folder for PgBouncer configuration
COPY --from=build /usr/src/app/config ./config

# Create data directories
RUN mkdir -p /usr/src/app/data && \
    chmod -R 777 /usr/src/app/data

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/main"]