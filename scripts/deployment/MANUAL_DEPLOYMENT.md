# Manual AWS Deployment Guide

This guide walks you through manually deploying OginiSearch to your AWS server.

## Prerequisites Check

1. **Verify PEM file permissions:**
   ```bash
   chmod 600 ~/Downloads/CNDB/cnsearch.pem
   ls -l ~/Downloads/CNDB/cnsearch.pem
   ```
   Should show: `-rw-------` (600 permissions)

2. **Test SSH connection:**
   ```bash
   ssh -i ~/Downloads/CNDB/cnsearch.pem ubuntu@18.135.83.96
   ```
   You should be able to connect without permission errors.

## Step-by-Step Manual Deployment

### Step 1: Connect to the Server

```bash
ssh -i ~/Downloads/CNDB/cnsearch.pem ubuntu@18.135.83.96
```

### Step 2: Update System and Install Dependencies

Once connected, run:

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl git docker.io docker-compose nodejs npm build-essential postgresql-client
```

### Step 3: Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # Should show v20.x.x
```

### Step 4: Install Docker Compose (if needed)

```bash
sudo apt-get install -y docker-compose-plugin
docker compose version
```

### Step 5: Create Deployment Directory

```bash
sudo mkdir -p /opt/oginisearch
sudo chown ubuntu:ubuntu /opt/oginisearch
cd /opt/oginisearch
```

### Step 6: Clone Repository

```bash
git clone -b main https://github.com/Preshiousy1/OginiSearch.git .
```

### Step 7: Configure Environment

```bash
# Copy the AWS production environment file
cp env-configs/aws-production.env .env

# Verify the PostgreSQL credentials are correct
cat .env | grep POSTGRES
```

You should see:
```
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=cnsearchdb
POSTGRES_USER=cnsearch2026
POSTGRES_PASSWORD=4(0@ZoWZ@2%NV*fhC02
```

### Step 8: Install Dependencies

```bash
npm ci
```

### Step 9: Build Application

```bash
npm run build
```

### Step 10: Test Database Connection

**Important**: When sourcing the .env file, use `set -a` to export all variables, or export the password directly to avoid shell interpretation issues:

```bash
# Method 1: Test with localhost (if PostgreSQL is on same server)
export PGPASSWORD='4(0@ZoWZ@2%NV*fhC02'
psql -h localhost -U cnsearch2026 -d cnsearchdb -c "SELECT version();"

# Method 2: Test with remote IP (if PostgreSQL is on different server)
# IMPORTANT: PostgreSQL uses IP/hostname directly, NO http:// protocol!
export PGPASSWORD='4(0@ZoWZ@2%NV*fhC02'
psql -h 18.135.83.96 -U cnsearch2026 -d cnsearchdb -c "SELECT version();"

# Method 3: Source .env with set -a (exports all variables)
set -a
source .env
set +a
psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version();"
```

**Note**: If PostgreSQL is NOT on localhost, you'll need to:
1. Update `POSTGRES_HOST` in the `.env` file to the remote PostgreSQL server IP/hostname
2. Ensure the EC2 security group allows outbound connections to the PostgreSQL port (5432)
3. Ensure the PostgreSQL server allows connections from your EC2 instance IP

If the connection fails, check:
- Is PostgreSQL running on the remote server?
- Is PostgreSQL configured to accept remote connections (`listen_addresses` in postgresql.conf)?
- Are firewall rules allowing connections from your EC2 instance?

### Step 11: Create Systemd Service

```bash
sudo nano /etc/systemd/system/oginisearch.service
```

Paste the following:

```ini
[Unit]
Description=OginiSearch Production Service
After=network.target postgresql.service redis.service
Requires=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/oginisearch
Environment="NODE_ENV=production"
EnvironmentFile=/opt/oginisearch/.env
ExecStart=/usr/bin/node dist/main
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=oginisearch

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/oginisearch

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
```

Save and exit (Ctrl+X, then Y, then Enter).

### Step 12: Enable and Start Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable oginisearch
sudo systemctl start oginisearch
```

### Step 13: Check Service Status

```bash
sudo systemctl status oginisearch
```

### Step 14: View Logs

```bash
sudo journalctl -u oginisearch -f
```

Press Ctrl+C to exit log view.

### Step 15: Test Application

From your local machine:

```bash
curl http://18.135.83.96:3000/health
```

## Creating Update Script

For easier future updates, create an update script on the server:

```bash
cat > /opt/oginisearch/deploy-update.sh << 'EOF'
#!/bin/bash
set -e
cd /opt/oginisearch
git fetch origin
git reset --hard origin/main
npm ci
npm run build
sudo systemctl restart oginisearch
echo "Deployment completed successfully"
EOF

chmod +x /opt/oginisearch/deploy-update.sh
```

## Future Updates

To update the application after initial deployment:

```bash
ssh -i ~/Downloads/CNDB/cnsearch.pem ubuntu@18.135.83.96
cd /opt/oginisearch
git pull origin main
npm ci
npm run build
sudo systemctl restart oginisearch
```

Or use the update script:

```bash
ssh -i ~/Downloads/CNDB/cnsearch.pem ubuntu@18.135.83.96 '/opt/oginisearch/deploy-update.sh'
```

## Useful Commands

### View Logs
```bash
ssh -i ~/Downloads/CNDB/cnsearch.pem ubuntu@18.135.83.96 'sudo journalctl -u oginisearch -f'
```

### Check Status
```bash
ssh -i ~/Downloads/CNDB/cnsearch.pem ubuntu@18.135.83.96 'sudo systemctl status oginisearch'
```

### Restart Service
```bash
ssh -i ~/Downloads/CNDB/cnsearch.pem ubuntu@18.135.83.96 'sudo systemctl restart oginisearch'
```

### Stop Service
```bash
ssh -i ~/Downloads/CNDB/cnsearch.pem ubuntu@18.135.83.96 'sudo systemctl stop oginisearch'
```

## Troubleshooting

### Service won't start
```bash
sudo journalctl -u oginisearch -n 50
```

### Permission denied errors
```bash
sudo chown -R ubuntu:ubuntu /opt/oginisearch
```

### Port already in use
```bash
sudo lsof -i :3000
```

### Database connection issues - PostgreSQL not running

**Problem**: Error `ECONNREFUSED 127.0.0.1:5432` means PostgreSQL is not running.

**Check PostgreSQL status:**
```bash
sudo pg_lsclusters
sudo systemctl status postgresql@16-main
```

**If PostgreSQL cluster is down, check logs:**
```bash
sudo journalctl -xeu postgresql@16-main.service
```

**Common issue: Out of memory**
If you see `could not map anonymous shared memory: Cannot allocate memory`, PostgreSQL's memory settings are too high for the server.

**Fix 1: Add swap space (recommended first step)**

If you see "Cannot allocate memory" errors, the server likely needs swap space:

```bash
# Create 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make swap permanent (survives reboots)
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab

# Verify swap is active
free -h
```

**Fix 2: Reduce PostgreSQL memory settings:**

If PostgreSQL still won't start after adding swap:

```bash
# Edit PostgreSQL config
sudo nano /etc/postgresql/16/main/postgresql.conf

# Change these values:
shared_buffers = 128MB          # Reduce from default (usually 256MB+)
max_connections = 50            # Reduce if set very high
effective_cache_size = 256MB    # Reduce from default (often 1GB+)
work_mem = 4MB                  # Reduce per-connection memory
maintenance_work_mem = 64MB     # Reduce maintenance operations memory
max_locks_per_transaction = 64  # Reduce lock memory

# Restart PostgreSQL
sudo systemctl restart postgresql@16-main

# Verify it's running
pg_isready -h localhost -p 5432
sudo systemctl status postgresql@16-main
```

**Start PostgreSQL:**
```bash
# Try starting the cluster
sudo pg_ctlcluster 16 main start

# Or via systemd
sudo systemctl start postgresql@16-main

# Enable auto-start on boot
sudo systemctl enable postgresql@16-main
```

**Verify database connection:**
```bash
cd /opt/oginisearch
export PGPASSWORD='4(0@ZoWZ@2%NV*fhC02'
psql -h localhost -U cnsearch2026 -d cnsearchdb -c "SELECT version();"
```

**After fixing PostgreSQL, restart OginiSearch:**
```bash
sudo systemctl restart oginisearch
sudo systemctl status oginisearch
```

### Database connection issues - Connection refused
```bash
source /opt/oginisearch/.env
PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1;"
```

### Check available memory and disk space
```bash
free -h
df -h /
```

