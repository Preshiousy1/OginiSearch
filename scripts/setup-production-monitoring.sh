#!/bin/bash

# ===================================================
# PRODUCTION MONITORING SETUP SCRIPT
# Task 4.6: Production Database Configuration
# ===================================================

set -e

echo "🚀 Setting up Production Monitoring for Ogini Search Engine..."

# === COLOR OUTPUT ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# === FUNCTIONS ===
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# === CHECK PREREQUISITES ===
log_info "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    log_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

log_success "Prerequisites check passed"

# === CREATE MONITORING NETWORK ===
log_info "Creating monitoring network..."
docker network create ogini-monitoring 2>/dev/null || log_warning "Network already exists"
log_success "Monitoring network created"

# === SETUP POSTGRESQL MONITORING ===
log_info "Setting up PostgreSQL monitoring..."

# Create PostgreSQL exporter configuration
cat > monitoring/postgresql-exporter.yml << EOF
DATA_SOURCE_NAME: "postgresql://postgres:postgres@postgres:5432/ogini_search_prod?sslmode=disable"
PG_EXPORTER_EXTEND_QUERY_PATH: /etc/postgres_exporter/queries.yaml
EOF

# Create custom PostgreSQL queries for search metrics
cat > monitoring/queries.yaml << EOF
# === OGINI SEARCH METRICS ===
ogini_search_queries:
  query: "SELECT COUNT(*) as count FROM pg_stat_activity WHERE query LIKE '%search%'"
  master: true
  metrics:
    - search_queries:
        usage: "GAUGE"
        description: "Number of active search queries"

ogini_index_operations:
  query: "SELECT COUNT(*) as count FROM pg_stat_activity WHERE query LIKE '%index%'"
  master: true
  metrics:
    - index_operations:
        usage: "GAUGE"
        description: "Number of active indexing operations"

ogini_document_count:
  query: "SELECT COUNT(*) as count FROM search_documents"
  master: true
  metrics:
    - total_documents:
        usage: "GAUGE"
        description: "Total number of documents in search index"

ogini_index_size:
  query: "SELECT pg_size_pretty(pg_total_relation_size('search_documents')) as size"
  master: true
  metrics:
    - index_size_bytes:
        usage: "GAUGE"
        description: "Size of search index in bytes"
EOF

log_success "PostgreSQL monitoring configuration created"

# === SETUP ALERTMANAGER ===
log_info "Setting up AlertManager..."

cat > monitoring/alertmanager/alertmanager.yml << EOF
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/YOUR_SLACK_WEBHOOK'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'
  routes:
    - match:
        severity: critical
      receiver: 'slack.critical'
      repeat_interval: 30m
    - match:
        severity: warning
      receiver: 'slack.warning'
      repeat_interval: 1h

receivers:
  - name: 'web.hook'
    webhook_configs:
      - url: 'http://127.0.0.1:5001/'

  - name: 'slack.critical'
    slack_configs:
      - channel: '#alerts-critical'
        title: '🚨 Critical Alert: {{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}'
        send_resolved: true

  - name: 'slack.warning'
    slack_configs:
      - channel: '#alerts-warning'
        title: '⚠️ Warning Alert: {{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}'
        send_resolved: true

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'dev', 'instance']
EOF

log_success "AlertManager configuration created"

# === CREATE ENHANCED DOCKER COMPOSE ===
log_info "Creating enhanced Docker Compose for production monitoring..."

cat > docker-compose.monitoring.yml << EOF
version: '3.8'

services:
  # === POSTGRESQL EXPORTER ===
  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    container_name: ogini-postgres-exporter
    networks:
      - ogini-monitoring
    environment:
      - DATA_SOURCE_NAME=postgresql://postgres:postgres@postgres:5432/ogini_search_prod?sslmode=disable
    volumes:
      - ./monitoring/queries.yaml:/etc/postgres_exporter/queries.yaml
    ports:
      - "9187:9187"
    restart: unless-stopped
    depends_on:
      - postgres

  # === NODE EXPORTER ===
  node-exporter:
    image: prom/node-exporter:latest
    container_name: ogini-node-exporter
    networks:
      - ogini-monitoring
    command:
      - '--path.rootfs=/host'
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    volumes:
      - /:/host:ro,rslave
    ports:
      - "9100:9100"
    restart: unless-stopped

  # === REDIS EXPORTER ===
  redis-exporter:
    image: oliver006/redis_exporter:latest
    container_name: ogini-redis-exporter
    networks:
      - ogini-monitoring
    environment:
      - REDIS_ADDR=redis://redis:6379
    ports:
      - "9121:9121"
    restart: unless-stopped
    depends_on:
      - redis

  # === ALERTMANAGER ===
  alertmanager:
    image: prom/alertmanager:latest
    container_name: ogini-alertmanager
    networks:
      - ogini-monitoring
    volumes:
      - ./monitoring/alertmanager:/etc/alertmanager
      - alertmanager_data:/alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
    ports:
      - "9093:9093"
    restart: unless-stopped

  # === PROMETHEUS ===
  prometheus:
    image: prom/prometheus:latest
    container_name: ogini-prometheus
    networks:
      - ogini-monitoring
    volumes:
      - ./monitoring/prometheus:/etc/prometheus
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
      - '--storage.tsdb.retention.time=30d'
      - '--storage.tsdb.retention.size=50GB'
    ports:
      - "9090:9090"
    restart: unless-stopped
    depends_on:
      - alertmanager

  # === GRAFANA ===
  grafana:
    image: grafana/grafana:latest
    container_name: ogini-grafana
    networks:
      - ogini-monitoring
    volumes:
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin123
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_INSTALL_PLUGINS=grafana-clock-panel,grafana-simple-json-datasource
    ports:
      - "3006:3000"
    restart: unless-stopped
    depends_on:
      - prometheus

volumes:
  prometheus_data:
  alertmanager_data:
  grafana_data:

networks:
  ogini-monitoring:
    external: true
EOF

log_success "Enhanced Docker Compose created"

# === CREATE GRAFANA DASHBOARDS ===
log_info "Setting up Grafana dashboards..."

mkdir -p monitoring/grafana/provisioning/dashboards
mkdir -p monitoring/grafana/provisioning/datasources

# Create datasource configuration
cat > monitoring/grafana/provisioning/datasources/prometheus.yml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
EOF

# Create dashboard configuration
cat > monitoring/grafana/provisioning/dashboards/dashboards.yml << EOF
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
EOF

log_success "Grafana configuration created"

# === CREATE STARTUP SCRIPT ===
cat > start-production-monitoring.sh << 'EOF'
#!/bin/bash

echo "🚀 Starting Production Monitoring Stack..."

# Start the main application with production config
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 30

# Start monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d

echo "✅ Production monitoring stack started!"
echo ""
echo "📊 Monitoring URLs:"
echo "  - Grafana: http://localhost:3006 (admin/admin123)"
echo "  - Prometheus: http://localhost:9090"
echo "  - AlertManager: http://localhost:9093"
echo ""
echo "🔍 PostgreSQL Metrics: http://localhost:9187/metrics"
echo "🖥️  System Metrics: http://localhost:9100/metrics"
echo "🔴 Redis Metrics: http://localhost:9121/metrics"
EOF

chmod +x start-production-monitoring.sh

# === CREATE HEALTH CHECK SCRIPT ===
cat > scripts/health-check.sh << 'EOF'
#!/bin/bash

echo "🔍 Health Check for Production Monitoring..."

# Check PostgreSQL
echo "📊 PostgreSQL Status:"
docker exec ogini-postgres-prod pg_isready -U postgres -d ogini_search_prod

# Check Prometheus
echo "📈 Prometheus Status:"
curl -s http://localhost:9090/-/healthy

# Check Grafana
echo "📊 Grafana Status:"
curl -s http://localhost:3006/api/health

# Check AlertManager
echo "🚨 AlertManager Status:"
curl -s http://localhost:9093/-/healthy

# Check exporters
echo "📊 Exporters Status:"
curl -s http://localhost:9187/metrics | grep -c "postgres_"
curl -s http://localhost:9100/metrics | grep -c "node_"
curl -s http://localhost:9121/metrics | grep -c "redis_"

echo "✅ Health check completed!"
EOF

chmod +x scripts/health-check.sh

# === FINAL SETUP ===
log_success "Production monitoring setup completed!"
echo ""
echo "📋 Next steps:"
echo "1. Update Slack webhook URL in monitoring/alertmanager/alertmanager.yml"
echo "2. Run: ./start-production-monitoring.sh"
echo "3. Access Grafana at http://localhost:3006 (admin/admin123)"
echo "4. Import dashboards from monitoring/grafana/dashboards/"
echo "5. Run health check: ./scripts/health-check.sh"
echo ""
echo "🎯 Task 4.6: Production Database Configuration - COMPLETED!" 