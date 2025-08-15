import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { SearchMetricsService } from '../../storage/postgresql/search-metrics.service';

/**
 * Lightweight Metrics API Controller
 * Provides access to search performance data
 */
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly searchMetrics: SearchMetricsService) {}

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
  getSearchMetrics() {
    return {
      status: 'success',
      data: this.searchMetrics.getMetrics(),
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
      data: this.searchMetrics.getPerformanceTrends(),
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
    const queryLimit = limit ? parseInt(limit, 10) : 10;
    return {
      status: 'success',
      data: this.searchMetrics.getRecentSlowQueries(queryLimit),
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
      data: this.searchMetrics.getMemoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }
}
