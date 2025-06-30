#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

const axios = require('axios');
const readline = require('readline');

const API_URL = process.env.API_URL || 'http://localhost:3000';

class WorkerDashboard {
    constructor() {
        this.refreshInterval = 5000; // 5 seconds
        this.isRunning = false;
        this.startTime = Date.now();
        this.lastStats = null;
    }

    async start() {
        console.clear();
        console.log('🚀 ConnectSearch Worker Management Dashboard');
        console.log('=' * 60);

        this.isRunning = true;

        // Set up keyboard listeners
        this.setupKeyboardHandlers();

        // Start monitoring loop
        await this.monitoringLoop();
    }

    setupKeyboardHandlers() {
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }

        process.stdin.on('keypress', async (str, key) => {
            if (key && key.ctrl && key.name === 'c') {
                process.exit();
            }

            switch (key?.name) {
                case '1':
                    await this.activateDormantWorkers();
                    break;
                case '2':
                    await this.forceJobPickup();
                    break;
                case '3':
                    await this.emergencyBoost();
                    break;
                case '4':
                    await this.runDiagnostics();
                    break;
                case '5':
                    await this.scaleWorkers();
                    break;
                case 'q':
                    process.exit();
                    break;
                case 'r':
                    this.refreshInterval = this.refreshInterval === 5000 ? 1000 : 5000;
                    console.log(`\n📱 Refresh rate changed to ${this.refreshInterval / 1000}s`);
                    break;
            }
        });
    }

    async monitoringLoop() {
        while (this.isRunning) {
            try {
                await this.displayDashboard();
                await this.sleep(this.refreshInterval);
            } catch (error) {
                console.error('❌ Error in monitoring loop:', error.message);
                await this.sleep(5000);
            }
        }
    }

    async displayDashboard() {
        console.clear();

        const [workerStatus, queueDashboard, performance] = await Promise.all([
            this.fetchWorkerStatus(),
            this.fetchQueueDashboard(),
            this.fetchRealtimePerformance(),
        ]);

        this.renderHeader();
        this.renderWorkerSummary(workerStatus);
        this.renderQueueStatus(queueDashboard);
        this.renderPerformanceMetrics(performance);
        this.renderAlerts(queueDashboard);
        this.renderKeyboardShortcuts();

        this.lastStats = { workerStatus, queueDashboard, performance };
    }

    renderHeader() {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        const uptimeStr = `${Math.floor(uptime / 60)}m ${uptime % 60}s`;

        console.log('\n🚀 ConnectSearch Worker Dashboard');
        console.log('=' * 60);
        console.log(`⏱️  Monitoring Time: ${uptimeStr} | Refresh: ${this.refreshInterval / 1000}s`);
        console.log(`🌐 API Endpoint: ${API_URL}`);
        console.log('-' * 60);
    }

    renderWorkerSummary(workerStatus) {
        if (!workerStatus) return;

        const { summary, queues } = workerStatus;
        const efficiencyColor =
            summary.efficiency > 0.7 ? '🟢' : summary.efficiency > 0.4 ? '🟡' : '🔴';

        console.log('\n📊 WORKER SUMMARY');
        console.log(
            `${efficiencyColor} Total Workers: ${summary.totalWorkers} | Active: ${summary.activeWorkers} | Dormant: ${summary.dormantWorkers}`,
        );
        console.log(
            `💪 Worker Efficiency: ${(summary.efficiency * 100).toFixed(
                1,
            )}% | Status: ${summary.status.toUpperCase()}`,
        );

        console.log('\n📋 QUEUE DETAILS');
        console.log(
            `🔄 Indexing Queue:     Concurrency: ${queues.indexing.concurrency} | Active: ${queues.indexing.active} | Waiting: ${queues.indexing.waiting}`,
        );
        console.log(
            `📦 Bulk Indexing:     Concurrency: ${queues.bulkIndexing.concurrency} | Active: ${queues.bulkIndexing.active} | Waiting: ${queues.bulkIndexing.waiting}`,
        );
    }

    renderQueueStatus(queueDashboard) {
        if (!queueDashboard) return;

        const { currentStats, performance, health } = queueDashboard;
        const healthColor =
            health.overall === 'healthy' ? '🟢' : health.overall === 'degraded' ? '🟡' : '🔴';

        console.log('\n🏥 QUEUE HEALTH');
        console.log(`${healthColor} Overall Health: ${health.overall.toUpperCase()}`);

        console.log('\n📈 QUEUE STATISTICS');
        console.log(`⏳ Total Waiting: ${currentStats.totalWaiting}`);
        console.log(`🏃 Total Active: ${currentStats.totalActive}`);
        console.log(`❌ Total Failed: ${currentStats.totalFailed}`);

        if (performance.projection) {
            const proj = performance.projection;
            console.log('\n🎯 COMPLETION PROJECTION');
            console.log(
                `⏱️  Estimated Completion: ${proj.estimatedHours ? `${proj.estimatedHours.toFixed(1)} hours` : 'Unknown'
                }`,
            );
            console.log(
                `🎯 Current Throughput: ${proj.currentThroughput ? `${proj.currentThroughput.toFixed(1)} docs/sec` : 'N/A'
                }`,
            );
            console.log(`📊 Confidence: ${proj.confidence || 'Unknown'}`);
        }
    }

    renderPerformanceMetrics(performance) {
        if (!performance) return;

        const { throughput, efficiency, system } = performance;
        const memoryColor =
            system.memoryUsagePercent > 0.8 ? '🔴' : system.memoryUsagePercent > 0.6 ? '🟡' : '🟢';

        console.log('\n⚡ PERFORMANCE METRICS');
        console.log(`🚀 Current Throughput: ${throughput.toFixed(1)} docs/sec`);
        console.log(`💪 Worker Efficiency: ${(efficiency * 100).toFixed(1)}%`);

        console.log('\n💾 SYSTEM RESOURCES');
        console.log(`${memoryColor} Memory Usage: ${(system.memoryUsagePercent * 100).toFixed(1)}%`);
        console.log(
            `⏰ Uptime: ${Math.floor(system.uptime / 3600)}h ${Math.floor((system.uptime % 3600) / 60)}m`,
        );
    }

    renderAlerts(queueDashboard) {
        if (!queueDashboard?.alerts || queueDashboard.alerts.length === 0) return;

        console.log('\n🚨 ALERTS');
        queueDashboard.alerts.forEach(alert => {
            const icon = alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '🟡' : '🟢';
            console.log(`${icon} ${alert.type.toUpperCase()}: ${alert.message}`);
        });
    }

    renderKeyboardShortcuts() {
        console.log('\n⌨️  KEYBOARD SHORTCUTS');
        console.log('1️⃣  Activate Dormant Workers  2️⃣  Force Job Pickup  3️⃣  Emergency Boost');
        console.log('4️⃣  Run Diagnostics           5️⃣  Scale Workers    R  Toggle Refresh Rate');
        console.log('Q  Quit Dashboard');
        console.log('-' * 60);
    }

    async fetchWorkerStatus() {
        try {
            const response = await axios.get(`${API_URL}/workers/status`, { timeout: 5000 });
            return response.data;
        } catch (error) {
            console.error('❌ Failed to fetch worker status:', error.message);
            return null;
        }
    }

    async fetchQueueDashboard() {
        try {
            const response = await axios.get(`${API_URL}/workers/queues/dashboard`, { timeout: 5000 });
            return response.data;
        } catch (error) {
            console.error('❌ Failed to fetch queue dashboard:', error.message);
            return null;
        }
    }

    async fetchRealtimePerformance() {
        try {
            const response = await axios.get(`${API_URL}/workers/performance/realtime`, {
                timeout: 5000,
            });
            return response.data;
        } catch (error) {
            console.error('❌ Failed to fetch performance metrics:', error.message);
            return null;
        }
    }

    async activateDormantWorkers() {
        console.log('\n🔄 Activating dormant workers...');
        try {
            const response = await axios.post(`${API_URL}/workers/activate-dormant`);
            console.log(`✅ ${response.data.message}`);
            console.log(`💪 Workers activated: ${response.data.workersActivated}`);
        } catch (error) {
            console.error('❌ Failed to activate workers:', error.message);
        }
        await this.sleep(2000);
    }

    async forceJobPickup() {
        console.log('\n🔄 Forcing job pickup...');
        try {
            const response = await axios.post(`${API_URL}/workers/force-job-pickup`);
            console.log(`✅ ${response.data.message}`);
            console.log(`📢 Workers notified: ${response.data.workersNotified}`);
        } catch (error) {
            console.error('❌ Failed to force job pickup:', error.message);
        }
        await this.sleep(2000);
    }

    async emergencyBoost() {
        console.log('\n🚨 ACTIVATING EMERGENCY BOOST...');
        try {
            const response = await axios.post(`${API_URL}/workers/emergency-boost`);
            console.log(`🚀 ${response.data.message}`);
            console.log(`⚠️  ${response.data.warning}`);
            console.log(`⏰ Duration: ${response.data.duration}`);
        } catch (error) {
            console.error('❌ Failed to activate emergency boost:', error.message);
        }
        await this.sleep(3000);
    }

    async runDiagnostics() {
        console.log('\n🔍 Running comprehensive diagnostics...');
        try {
            const response = await axios.get(`${API_URL}/workers/diagnostics`);
            const diagnostics = response.data;

            console.log(`📊 Diagnostics Status: ${diagnostics.status.toUpperCase()}`);

            Object.entries(diagnostics.checks).forEach(([name, check]) => {
                const icon = check.status === 'pass' ? '✅' : '❌';
                console.log(`${icon} ${name}: ${check.status}`);
                if (check.error) console.log(`   Error: ${check.error}`);
            });
        } catch (error) {
            console.error('❌ Failed to run diagnostics:', error.message);
        }
        await this.sleep(5000);
    }

    async scaleWorkers() {
        console.log('\n📈 Auto-scaling workers based on current load...');
        try {
            const response = await axios.post(`${API_URL}/workers/scale-workers`, {
                autoScale: true,
            });

            console.log(`✅ ${response.data.message}`);
            if (response.data.changes) {
                console.log(`🔄 Changes made:`);
                Object.entries(response.data.changes).forEach(([queue, change]) => {
                    console.log(`   ${queue}: ${change.from} → ${change.to}`);
                });
            }
        } catch (error) {
            console.error('❌ Failed to scale workers:', error.message);
        }
        await this.sleep(3000);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down dashboard...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down dashboard...');
    process.exit(0);
});

// Start the dashboard
const dashboard = new WorkerDashboard();
dashboard.start().catch(error => {
    console.error('❌ Dashboard startup failed:', error);
    process.exit(1);
});

module.exports = WorkerDashboard;
