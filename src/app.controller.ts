import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('health/memory')
  getMemoryHealth() {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const externalMB = Math.round(usage.external / 1024 / 1024);
    const rssUsedMB = Math.round(usage.rss / 1024 / 1024);

    const memoryUsagePercent = Math.round((usage.heapUsed / usage.heapTotal) * 100);

    return {
      status:
        memoryUsagePercent > 85 ? 'warning' : memoryUsagePercent > 95 ? 'critical' : 'healthy',
      memory: {
        heapUsed: `${heapUsedMB}MB`,
        heapTotal: `${heapTotalMB}MB`,
        external: `${externalMB}MB`,
        rss: `${rssUsedMB}MB`,
        usagePercent: `${memoryUsagePercent}%`,
      },
      raw: usage,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('health/gc')
  forceGarbageCollection() {
    if (global.gc) {
      const beforeGC = process.memoryUsage();
      global.gc();
      const afterGC = process.memoryUsage();

      return {
        status: 'success',
        message: 'Garbage collection forced',
        before: {
          heapUsed: Math.round(beforeGC.heapUsed / 1024 / 1024),
          heapTotal: Math.round(beforeGC.heapTotal / 1024 / 1024),
        },
        after: {
          heapUsed: Math.round(afterGC.heapUsed / 1024 / 1024),
          heapTotal: Math.round(afterGC.heapTotal / 1024 / 1024),
        },
        freedMB: Math.round((beforeGC.heapUsed - afterGC.heapUsed) / 1024 / 1024),
        timestamp: new Date().toISOString(),
      };
    } else {
      return {
        status: 'error',
        message: 'Garbage collection not available. Start with --expose-gc flag.',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
