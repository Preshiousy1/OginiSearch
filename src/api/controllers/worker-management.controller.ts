import { Controller, Get, Post, Body, HttpStatus, Logger, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WorkerManagementService, DiagnosticsReport } from '../services/worker-management.service';

@ApiTags('Worker Management')
@Controller('workers')
export class WorkerManagementController {
  private readonly logger = new Logger(WorkerManagementController.name);

  constructor(private readonly workerManagementService: WorkerManagementService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get comprehensive worker status and statistics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Worker status information',
    schema: {
      type: 'object',
      properties: {
        totalWorkers: { type: 'number' },
        activeWorkers: { type: 'number' },
        dormantWorkers: { type: 'number' },
        workers: { type: 'array' },
        queues: { type: 'object' },
        performance: { type: 'object' },
        systemResources: { type: 'object' },
      },
    },
  })
  async getWorkerStatus() {
    try {
      return await this.workerManagementService.getComprehensiveWorkerStatus();
    } catch (error) {
      this.logger.error(`Failed to get worker status: ${error.message}`);
      throw error;
    }
  }

  @Get('queues/dashboard')
  @ApiOperation({ summary: 'Get queue dashboard with real-time statistics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue dashboard data',
  })
  async getQueueDashboard() {
    try {
      return await this.workerManagementService.getQueueDashboard();
    } catch (error) {
      this.logger.error(`Failed to get queue dashboard: ${error.message}`);
      throw error;
    }
  }

  @Post('activate-dormant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate all dormant workers to pick up jobs' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Dormant workers activated',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        workersActivated: { type: 'number' },
        details: { type: 'object' },
      },
    },
  })
  async activateDormantWorkers() {
    try {
      const result = await this.workerManagementService.activateAllDormantWorkers();
      this.logger.log(`Activated ${result.workersActivated} dormant workers`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to activate dormant workers: ${error.message}`);
      throw error;
    }
  }

  @Post('force-job-pickup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force all workers to immediately check for new jobs' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Job pickup forced for all workers',
  })
  async forceJobPickup() {
    try {
      const result = await this.workerManagementService.forceJobPickup();
      this.logger.log(`Forced job pickup for ${result.workersNotified} workers`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to force job pickup: ${error.message}`);
      throw error;
    }
  }

  @Post('scale-workers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dynamically scale worker concurrency based on queue load' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Workers scaled successfully',
  })
  async scaleWorkers(@Body() scaleOptions: { targetConcurrency?: number; autoScale?: boolean }) {
    try {
      const result = await this.workerManagementService.dynamicScaleWorkers(scaleOptions);
      this.logger.log(`Scaled workers: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to scale workers: ${error.message}`);
      throw error;
    }
  }

  @Get('performance/realtime')
  @ApiOperation({ summary: 'Get real-time performance metrics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Real-time performance data',
  })
  async getRealtimePerformance() {
    try {
      return await this.workerManagementService.getRealtimePerformanceMetrics();
    } catch (error) {
      this.logger.error(`Failed to get realtime performance: ${error.message}`);
      throw error;
    }
  }

  @Post('emergency-boost')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Emergency performance boost - maximize all available resources' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Emergency boost activated',
  })
  async emergencyBoost() {
    try {
      const result = await this.workerManagementService.emergencyPerformanceBoost();
      this.logger.warn(`EMERGENCY BOOST ACTIVATED: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to activate emergency boost: ${error.message}`);
      throw error;
    }
  }

  @Get('diagnostics')
  @ApiOperation({ summary: 'Run comprehensive diagnostics on worker system' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Diagnostic results',
  })
  async runDiagnostics(): Promise<DiagnosticsReport> {
    try {
      return await this.workerManagementService.runComprehensiveDiagnostics();
    } catch (error) {
      this.logger.error(`Failed to run diagnostics: ${error.message}`);
      throw error;
    }
  }
}
