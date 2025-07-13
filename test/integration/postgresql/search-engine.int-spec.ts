import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PostgreSQLSearchEngine } from '../../../src/storage/postgresql/postgresql-search-engine';
import { SearchQueryDto } from '../../../src/api/dtos/search.dto';

describe('PostgreSQLSearchEngine (Integration)', () => {
  let module: TestingModule;
  let searchEngine: PostgreSQLSearchEngine;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PostgreSQLSearchEngine,
        {
          provide: DataSource,
          useValue: {
            query: jest.fn(),
          },
        },
      ],
    }).compile();

    searchEngine = module.get<PostgreSQLSearchEngine>(PostgreSQLSearchEngine);
    dataSource = module.get<DataSource>(DataSource);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Search Functionality', () => {
    const testIndex = 'test_products';

    describe('Basic Search', () => {
      it('should handle simple text search', async () => {
        const query: SearchQueryDto = {
          query: 'smartphone',
          size: 10,
        };

        (dataSource.query as jest.Mock).mockResolvedValueOnce([
          { id: '1', content: { title: 'Smartphone X' }, score: 1.0 },
        ]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.data.hits).toHaveLength(1);
        expect(result.metrics).toBeDefined();
        expect(result.metrics.queryParsing).toBeGreaterThan(0);
      });

      it('should handle empty search query', async () => {
        const query: SearchQueryDto = {
          query: '',
          size: 10,
        };

        (dataSource.query as jest.Mock).mockResolvedValueOnce([]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.data.hits).toHaveLength(0);
        expect(result.data.total).toBe(0);
      });
    });

    describe('Field-Specific Search', () => {
      it('should handle match query on specific field', async () => {
        const query: SearchQueryDto = {
          query: {
            match: {
              field: 'title',
              value: 'smartphone',
            },
          },
        };

        (dataSource.query as jest.Mock).mockResolvedValueOnce([
          { id: '1', content: { title: 'Smartphone X' }, score: 1.0 },
        ]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.data.hits).toHaveLength(1);
        expect(dataSource.query).toHaveBeenCalledWith(
          expect.stringContaining("content->>'title'"),
          expect.any(Array),
        );
      });

      it('should handle term query with array field', async () => {
        const query: SearchQueryDto = {
          query: {
            term: {
              categories: ['electronics', 'mobile'],
            },
          },
        };

        (dataSource.query as jest.Mock).mockResolvedValueOnce([
          {
            id: '1',
            content: { categories: ['electronics', 'mobile'] },
            score: 1.0,
          },
        ]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.data.hits).toHaveLength(1);
        expect(dataSource.query).toHaveBeenCalledWith(
          expect.stringContaining('= ANY'),
          expect.any(Array),
        );
      });
    });

    describe('Wildcard Search', () => {
      it('should handle wildcard query', async () => {
        const query: SearchQueryDto = {
          query: {
            wildcard: {
              title: 'smart*',
            },
          },
        };

        (dataSource.query as jest.Mock).mockResolvedValueOnce([
          { id: '1', content: { title: 'Smartphone' }, score: 1.0 },
          { id: '2', content: { title: 'Smart Watch' }, score: 0.8 },
        ]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.data.hits).toHaveLength(2);
        expect(dataSource.query).toHaveBeenCalledWith(
          expect.stringContaining('ILIKE'),
          expect.any(Array),
        );
      });

      it('should handle complex wildcard patterns', async () => {
        const query: SearchQueryDto = {
          query: {
            wildcard: {
              title: '*phone*',
            },
          },
        };

        (dataSource.query as jest.Mock).mockResolvedValueOnce([
          { id: '1', content: { title: 'Smartphone' }, score: 1.0 },
          { id: '2', content: { title: 'iPhone' }, score: 0.9 },
        ]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.data.hits).toHaveLength(2);
        expect(result.metrics.queryParsing).toBeDefined();
      });
    });

    describe('Faceted Search', () => {
      it('should return facets for specified fields', async () => {
        const query: SearchQueryDto = {
          query: 'phone',
          facets: ['category', 'brand'],
        };

        (dataSource.query as jest.Mock)
          .mockResolvedValueOnce([{ id: '1', content: {}, score: 1.0 }])
          .mockResolvedValueOnce([
            { key: 'electronics', count: '5' },
            { key: 'mobile', count: '3' },
          ])
          .mockResolvedValueOnce([
            { key: 'Samsung', count: '2' },
            { key: 'Apple', count: '1' },
          ]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.data.hits).toBeDefined();
        expect(result.data.facets).toBeDefined();
        expect(result.data.facets.category).toHaveLength(2);
        expect(result.data.facets.brand).toHaveLength(2);
      });
    });

    describe('Performance Monitoring', () => {
      it('should track query execution metrics', async () => {
        const query: SearchQueryDto = {
          query: 'test',
          highlight: true,
          facets: ['category'],
        };

        (dataSource.query as jest.Mock)
          .mockResolvedValueOnce([{ 'QUERY PLAN': [{}] }])
          .mockResolvedValueOnce([{ id: '1', content: {}, score: 1.0 }])
          .mockResolvedValueOnce([{ highlight: '<em>test</em>' }])
          .mockResolvedValueOnce([{ key: 'electronics', count: '5' }]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.metrics).toMatchObject({
          queryParsing: expect.any(Number),
          execution: expect.any(Number),
          highlighting: expect.any(Number),
          faceting: expect.any(Number),
          total: expect.any(Number),
        });
      });

      it('should include query plan analysis', async () => {
        const query: SearchQueryDto = {
          query: 'test',
        };

        (dataSource.query as jest.Mock)
          .mockResolvedValueOnce([
            {
              'QUERY PLAN': [
                {
                  Plan: {
                    'Node Type': 'Seq Scan',
                    'Plan Rows': 1500,
                  },
                  'Total Cost': 1200,
                },
              ],
            },
          ])
          .mockResolvedValueOnce([{ id: '1', content: {}, score: 1.0 }]);

        const result = await searchEngine.search(testIndex, query);

        expect(result.metrics.planStats).toBeDefined();
        expect(result.metrics.planStats.Plan['Node Type']).toBe('Seq Scan');
      });
    });

    describe('Error Handling', () => {
      it('should handle invalid field names gracefully', async () => {
        const query: SearchQueryDto = {
          query: {
            match: {
              field: 'nonexistent_field',
              value: 'test',
            },
          },
        };

        (dataSource.query as jest.Mock).mockRejectedValueOnce(
          new Error('column "nonexistent_field" does not exist'),
        );

        await expect(searchEngine.search(testIndex, query)).rejects.toThrow();
      });

      it('should handle malformed JSON in content gracefully', async () => {
        const query: SearchQueryDto = {
          query: 'test',
        };

        (dataSource.query as jest.Mock).mockRejectedValueOnce(
          new Error('invalid input syntax for type json'),
        );

        await expect(searchEngine.search(testIndex, query)).rejects.toThrow();
      });
    });
  });

  describe('Suggestions', () => {
    it('should return suggestions for a given term', async () => {
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([]) // CREATE EXTENSION result
        .mockResolvedValueOnce([
          { text: 'smartphone', score: '0.8', freq: '10' },
          { text: 'smart watch', score: '0.6', freq: '5' },
        ]);

      const result = await searchEngine.getSuggestions('test_products', 'smart');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        text: 'smartphone',
        score: 0.8,
        freq: 10,
      });
    });

    it('should handle field-specific suggestions', async () => {
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([]) // CREATE EXTENSION result
        .mockResolvedValueOnce([
          { text: 'Samsung Galaxy', score: '0.8', freq: '5' },
        ]);

      const result = await searchEngine.getSuggestions(
        'test_products',
        'sam',
        'brand',
      );

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Samsung Galaxy');
    });
  });
}); 