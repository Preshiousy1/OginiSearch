import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { PostgreSQLService } from '../../storage/postgresql/postgresql.service';

/**
 * Lightweight Metrics API Controller
 * Provides access to search performance data
 */
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly postgresqlService: PostgreSQLService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Get search performance metrics',
    description:
      'Returns overall search performance data including latency, cache hit rate, and query breakdown',
  })
  @ApiResponse({
    status: 200,
    description: 'Search metrics data',
  })
  async getSearchMetrics() {
    const dbStats = await this.postgresqlService.getDatabaseStats();
    return {
      status: 'success',
      data: {
        totalDocuments: dbStats.totalDocuments,
        indexes: dbStats.indexes,
        indexSizes: dbStats.indexSizes,
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('search/trends')
  @ApiOperation({
    summary: 'Get search performance trends',
    description: 'Returns performance trends over different time periods',
  })
  @ApiResponse({
    status: 200,
    description: 'Search performance trends',
  })
  getPerformanceTrends() {
    return {
      status: 'success',
      data: {
        message: 'Performance trends not available in simplified version',
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('search/slow-queries')
  @ApiOperation({
    summary: 'Get recent slow queries',
    description: 'Returns recent queries that exceeded the slow query threshold',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of slow queries to return',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Recent slow queries',
  })
  getSlowQueries(@Query('limit') limit?: string) {
    return {
      status: 'success',
      data: {
        message: 'Slow query tracking not available in simplified version',
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('search/memory')
  @ApiOperation({
    summary: 'Get metrics service memory usage',
    description: 'Returns memory usage statistics for the metrics service',
  })
  @ApiResponse({
    status: 200,
    description: 'Memory usage statistics',
  })
  getMemoryUsage() {
    return {
      status: 'success',
      data: {
        message: 'Memory usage tracking not available in simplified version',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
