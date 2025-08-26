import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { QueryProcessorService } from '../../search/query-processor.service';
import { EntityExtractionService } from '../../search/services/entity-extraction.service';
import { LocationProcessorService } from '../../search/services/location-processor.service';
import { QueryExpansionService } from '../../search/services/query-expansion.service';
import { QueryComponents } from '../../search/interfaces/intelligent-search.interface';

interface IntelligentSearchRequest {
  query: string;
  userLocation?: {
    lat: number;
    lng: number;
  };
}

interface IntelligentSearchResponse {
  success: boolean;
  data: {
    original: string;
    processed: QueryComponents;
    timestamp: string;
  };
}

@Controller('intelligent-search')
export class IntelligentSearchController {
  constructor(
    private readonly queryProcessor: QueryProcessorService,
    private readonly entityExtraction: EntityExtractionService,
    private readonly locationProcessor: LocationProcessorService,
    private readonly queryExpansion: QueryExpansionService,
  ) {}

  @Post('process')
  async processQuery(
    @Body() request: IntelligentSearchRequest,
  ): Promise<IntelligentSearchResponse> {
    try {
      const processed = await this.queryProcessor.processIntelligentQuery(
        { query: request.query, fields: ['_all'] },
        request.userLocation,
      );

      return {
        success: true,
        data: {
          original: request.query,
          processed,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        data: {
          original: request.query,
          processed: null,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  @Get('test')
  async testQuery(@Query('q') query: string): Promise<IntelligentSearchResponse> {
    return this.processQuery({ query });
  }

  @Get('entities')
  async extractEntities(@Query('q') query: string) {
    const entities = await this.entityExtraction.extractEntities(query);
    return {
      success: true,
      data: {
        query,
        entities,
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Get('location')
  async processLocation(
    @Query('q') query: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const userLocation = lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined;
    const locationResult = await this.locationProcessor.processLocationQuery(query, userLocation);

    return {
      success: true,
      data: {
        query,
        locationResult,
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Get('expand')
  async expandQuery(@Query('q') query: string) {
    const entities = await this.entityExtraction.extractEntities(query);
    const expansion = await this.queryExpansion.expandQuery(
      query,
      entities.businessTypes,
      entities.services,
    );

    return {
      success: true,
      data: {
        query,
        expansion,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
