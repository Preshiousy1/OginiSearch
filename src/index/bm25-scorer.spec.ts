import { BM25Scorer } from './bm25-scorer';
import { IndexStatsService } from './index-stats.service';

describe('BM25Scorer', () => {
  let scorer: BM25Scorer;
  let indexStats: IndexStatsService;

  beforeEach(() => {
    indexStats = new IndexStatsService();
    scorer = new BM25Scorer(indexStats);

    // Set up test statistics
    setupTestData();
  });

  function setupTestData() {
    // Add documents with field lengths
    indexStats.updateDocumentStats('doc1', { title: 5, body: 100 });
    indexStats.updateDocumentStats('doc2', { title: 3, body: 150 });
    indexStats.updateDocumentStats('doc3', { title: 7, body: 50 });

    // Add term statistics
    // Term "apple" appears in all 3 documents
    indexStats.updateTermStats('apple', 'doc1');
    indexStats.updateTermStats('apple', 'doc2');
    indexStats.updateTermStats('apple', 'doc3');

    // Term "banana" appears in 2 documents
    indexStats.updateTermStats('banana', 'doc1');
    indexStats.updateTermStats('banana', 'doc3');

    // Term "cherry" appears in 1 document
    indexStats.updateTermStats('cherry', 'doc2');
  }

  it('should be defined', () => {
    expect(scorer).toBeDefined();
  });

  it('should calculate BM25 scores correctly', () => {
    // Term frequency for "banana" in doc1 title is 2
    const score = scorer.score('banana', 'doc1', 'title', 2);

    // Since banana appears in 2 out of 3 docs, its IDF component will be lower
    expect(score).toBeGreaterThan(0);

    // Cherry is more rare (appears in only 1 doc), so its score should be higher
    // for the same term frequency
    const cherryScore = scorer.score('cherry', 'doc2', 'title', 2);
    expect(cherryScore).toBeGreaterThan(score);

    // Zero term frequency should result in zero score
    expect(scorer.score('banana', 'doc2', 'title', 0)).toBe(0);

    // Unknown term should result in zero score
    expect(scorer.score('unknown', 'doc1', 'title', 5)).toBe(0);
  });

  it('should handle field weights correctly', () => {
    // Create a scorer with field weights
    const weightedScorer = new BM25Scorer(indexStats, {
      fieldWeights: { title: 3.0, body: 1.0 },
    });

    // Score for title should be ~3x the score for body with same params
    const titleScore = weightedScorer.score('banana', 'doc1', 'title', 1);
    const bodyScore = weightedScorer.score('banana', 'doc1', 'body', 1);

    // Due to length normalization effects, it might not be exactly 3x
    // but should be significantly higher
    expect(titleScore).toBeGreaterThan(bodyScore * 2);
  });

  it('should allow parameter adjustment', () => {
    // Create with default params
    const scorer1 = new BM25Scorer(indexStats);

    // Create with custom params - higher k1 emphasizes term frequency more
    const scorer2 = new BM25Scorer(indexStats, { k1: 2.0, b: 0.75 });

    // For a term with high frequency, scorer2 should give higher score
    const score1 = scorer1.score('banana', 'doc1', 'title', 5);
    const score2 = scorer2.score('banana', 'doc1', 'title', 5);

    expect(score2).toBeGreaterThan(score1);

    // Update parameters
    scorer1.setParameters({ k1: 2.0 });
    const updatedScore = scorer1.score('banana', 'doc1', 'title', 5);
    expect(updatedScore).toBeCloseTo(score2);
  });

  it('should calculate combined scores for multiple fields', () => {
    // Set up scorer with field weights
    const weightedScorer = new BM25Scorer(indexStats, {
      fieldWeights: { title: 2.0, body: 1.0 },
    });

    // Calculate individual scores
    const titleScore = weightedScorer.score('banana', 'doc1', 'title', 2);
    const bodyScore = weightedScorer.score('banana', 'doc1', 'body', 5);

    // Calculate combined score
    const combinedScore = weightedScorer.scoreMultipleFields('banana', 'doc1', {
      title: 2,
      body: 5,
    });

    // Combined score should equal sum of individual scores
    expect(combinedScore).toBeCloseTo(titleScore + bodyScore);
  });

  it('should return its name and parameters', () => {
    expect(scorer.getName()).toBe('bm25');

    const params = scorer.getParameters();
    expect(params).toHaveProperty('k1');
    expect(params).toHaveProperty('b');
    expect(params).toHaveProperty('fieldWeights');
  });
});
