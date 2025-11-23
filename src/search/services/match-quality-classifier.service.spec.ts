import { Test, TestingModule } from '@nestjs/testing';
import {
  MatchQualityClassifierService,
  MatchQualityTier,
} from './match-quality-classifier.service';

describe('MatchQualityClassifierService', () => {
  let service: MatchQualityClassifierService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MatchQualityClassifierService],
    }).compile();

    service = module.get<MatchQualityClassifierService>(MatchQualityClassifierService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('classifyMatchQuality', () => {
    it('should classify perfect exact match', () => {
      const result = {
        source: { name: 'Pencil Store' },
      };
      const query = 'pencil store';

      const classification = service.classifyMatchQuality(result, query);

      expect(classification.tier).toBe(MatchQualityTier.EXACT_MATCH);
      expect(classification.matchType).toBe('perfect');
      expect(classification.confidence).toBe(1.0);
      expect(classification.details.isPerfectMatch).toBe(true);
    });

    it('should classify prefix match as exact', () => {
      const result = {
        source: { name: 'Pencil Store and Supplies' },
      };
      const query = 'pencil store';

      const classification = service.classifyMatchQuality(result, query);

      expect(classification.tier).toBe(MatchQualityTier.EXACT_MATCH);
      expect(classification.matchType).toBe('prefix');
      expect(classification.details.startsWithQuery).toBe(true);
    });

    it('should classify substring match as exact', () => {
      const result = {
        source: { name: 'The Pencil Store' },
      };
      const query = 'pencil store';

      const classification = service.classifyMatchQuality(result, query);

      expect(classification.tier).toBe(MatchQualityTier.EXACT_MATCH);
      expect(classification.matchType).toBe('substring');
      expect(classification.details.containsQuery).toBe(true);
    });

    it('should classify fuzzy match as close', () => {
      const result = {
        source: { name: 'Pensil Store' },
        score: 3.5,
      };
      const query = 'pencil store';

      const classification = service.classifyMatchQuality(result, query);

      expect(classification.tier).toBe(MatchQualityTier.CLOSE_MATCH);
      expect(classification.matchType).toBe('fuzzy');
      expect(classification.details.editDistance).toBeDefined();
      expect(classification.details.editDistance).toBeLessThanOrEqual(3);
    });

    it('should classify typo-corrected match as close', () => {
      const result = {
        source: { name: 'Pencil Store' },
      };
      const query = 'pensil';
      const typoCorrection = {
        originalQuery: 'pensil',
        correctedQuery: 'pencil',
        confidence: 0.9,
        corrections: [
          {
            original: 'pensil',
            correction: 'pencil',
            confidence: 0.9,
          },
        ],
      };

      const classification = service.classifyMatchQuality(result, query, typoCorrection);

      expect(classification.tier).toBe(MatchQualityTier.CLOSE_MATCH);
      expect(classification.matchType).toContain('typo_corrected');
      expect(classification.details.isTypoCorrection).toBe(true);
    });

    it('should classify high BM25 score as close match', () => {
      const result = {
        source: { name: 'Office Supplies Store' },
        score: 6.5, // High BM25 score
      };
      const query = 'pencil';

      const classification = service.classifyMatchQuality(result, query);

      expect(classification.tier).toBe(MatchQualityTier.CLOSE_MATCH);
      expect(classification.matchType).toBe('high_text_score');
    });

    it('should classify weak match as other', () => {
      const result = {
        source: { name: 'General Store' },
        score: 1.2,
      };
      const query = 'pencil';

      const classification = service.classifyMatchQuality(result, query);

      expect(classification.tier).toBe(MatchQualityTier.OTHER_MATCH);
      expect(classification.matchType).toBe('other');
    });

    it('should handle all query words present', () => {
      const result = {
        source: { name: 'Luxury Hotel Lagos' },
      };
      const query = 'luxury hotel';

      const classification = service.classifyMatchQuality(result, query);

      expect(classification.tier).toBe(MatchQualityTier.EXACT_MATCH);
      expect(classification.matchType).toBe('all_words');
    });
  });

  describe('classifyBatch', () => {
    it('should classify multiple results efficiently', () => {
      const results = [
        { source: { name: 'Pencil Store' } },
        { source: { name: 'Pensil Store' }, score: 3.0 },
        { source: { name: 'Office Supplies' }, score: 1.5 },
      ];
      const query = 'pencil';

      const classifications = service.classifyBatch(results, query);

      expect(classifications.size).toBe(3);
      expect(classifications.get(results[0])!.tier).toBe(MatchQualityTier.EXACT_MATCH);
      expect(classifications.get(results[1])!.tier).toBe(MatchQualityTier.CLOSE_MATCH);
      expect(classifications.get(results[2])!.tier).toBe(MatchQualityTier.OTHER_MATCH);
    });
  });

  describe('getTierStatistics', () => {
    it('should calculate tier statistics correctly', () => {
      const results = [
        { source: { name: 'Pencil Store' } },
        { source: { name: 'The Pencil Shop' } },
        { source: { name: 'Pensil Store' }, score: 3.0 },
        { source: { name: 'Office Supplies' }, score: 1.5 },
      ];
      const query = 'pencil';

      const classifications = service.classifyBatch(results, query);
      const stats = service.getTierStatistics(classifications);

      expect(stats.exact).toBe(2);
      expect(stats.close).toBe(1);
      expect(stats.other).toBe(1);
      expect(stats.total).toBe(4);
    });
  });
});
