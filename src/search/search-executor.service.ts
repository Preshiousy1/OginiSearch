import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  QueryExecutionPlan,
  QueryExecutionStep,
  TermQueryStep,
  BooleanQueryStep,
  PhraseQueryStep,
  WildcardQueryStep,
  MatchAllQueryStep,
} from './interfaces/query-processor.interface';
import { PostingList } from '../index/interfaces/posting.interface';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { IndexStatsService } from '../index/index-stats.service';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';
import { SimplePostingList } from 'src/index/posting-list';
import { TermPostingsRepository } from 'src/storage/mongodb/repositories/term-postings.repository';

interface SearchMatch {
  id: string;
  score: number;
  document?: any;
}

interface SearchOptions {
  size?: number;
  from?: number;
  sort?: string;
  fields?: string[];
  highlight?: boolean;
  filter?: Record<string, any>;
}

interface SearchResult {
  totalHits: number;
  maxScore: number;
  hits: Array<{
    id: string;
    score: number;
    document: Record<string, any>;
  }>;
}

@Injectable()
export class SearchExecutorService {
  private readonly logger = new Logger(SearchExecutorService.name);

  constructor(
    @Inject('TERM_DICTIONARY')
    private readonly termDictionary: InMemoryTermDictionary,
    private readonly documentStorage: DocumentStorageService,
    private readonly indexStats: IndexStatsService,
    private readonly analyzerRegistry: AnalyzerRegistryService,
    private readonly termPostingsRepository: TermPostingsRepository,
  ) {}

  async executeQuery(
    indexName: string,
    executionPlan: QueryExecutionPlan,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    this.logger.debug(`Executing query plan for index: ${indexName}`);

    // Default values for search options
    const { from = 0, size = 10, sort, filter } = options;

    // Execute the query plan to get matching document IDs with scores
    const matches = (await this.executeQueryPlan(indexName, executionPlan)).map(match => ({
      ...match,
      index: indexName,
      score: match.score || 1.0, // Default score if not provided
    }));

    // Apply any filter conditions if provided
    const filteredMatches = await this.applyFilters(matches, filter, indexName);

    // Sort results by score or specified sort field
    const sortedMatches = this.sortMatches(filteredMatches, sort);

    // Paginate the results
    const paginatedMatches = sortedMatches.slice(from, from + size);

    // Get actual documents for the matching IDs
    const documents = await this.fetchDocuments(
      indexName,
      paginatedMatches.map(m => m.id),
    );

    // Build the final search result
    const maxScore = sortedMatches.length > 0 ? sortedMatches[0].score : 0;

    const hits = paginatedMatches.map(match => ({
      id: match.id,
      score: match.score,
      document: documents[match.id] || null,
    }));

    return {
      totalHits: filteredMatches.length,
      maxScore,
      hits,
    };
  }

  private async executeQueryPlan(
    indexName: string,
    plan: QueryExecutionPlan,
  ): Promise<Array<{ id: string; score: number }>> {
    // Execute each step in the plan
    const results = await Promise.all(
      plan.steps.map(step => this.executeQueryStep(indexName, step)),
    );

    // Combine results from all steps
    return results.flat();
  }

  private async executeQueryStep(
    indexName: string,
    step: QueryExecutionStep,
  ): Promise<Array<{ id: string; score: number }>> {
    switch (step.type) {
      case 'term':
        return this.executeTermStep(indexName, step as TermQueryStep);
      case 'boolean':
        return this.executeBooleanStep(indexName, step as BooleanQueryStep);
      case 'phrase':
        return this.executePhraseStep(indexName, step as PhraseQueryStep);
      case 'wildcard':
        return this.executeWildcardStep(indexName, step as WildcardQueryStep);
      case 'match_all':
        return this.executeMatchAllStep(indexName, step as MatchAllQueryStep);
      default:
        throw new Error(`Unsupported query step type: ${step.type}`);
    }
  }

  /**
   * Get terms for a specific index from MongoDB storage
   * REDIS-RESILIENT: Falls back to MongoDB if Redis/memory fails
   */
  private async getTermsByIndex(indexName: string): Promise<string[]> {
    try {
      // First try to get terms from in-memory cache (fast path)
      // This will fail gracefully if Redis is down
      let memoryTerms: string[] = [];
      try {
        memoryTerms = this.termDictionary.getTermsForIndex(indexName);
        this.logger.debug(`Found ${memoryTerms.length} terms in memory for index: ${indexName}`);
        if (memoryTerms.length > 0) {
          this.logger.debug(`Sample memory terms: ${memoryTerms.slice(0, 5).join(', ')}`);
        }
      } catch (error) {
        this.logger.warn(`Memory term lookup failed for ${indexName}: ${error.message}`);
      }

      if (memoryTerms.length > 0) {
        return memoryTerms;
      }

      // Fallback to MongoDB if no terms in memory (ALWAYS works even if Redis is down)
      this.logger.debug(`Falling back to MongoDB for terms in index: ${indexName}`);
      const termPostings = await this.termPostingsRepository.findByIndex(indexName);

      // MongoDB now stores terms in index-aware format (index:field:term) - no conversion needed
      const mongoTerms = termPostings.map(tp => tp.term);
      this.logger.debug(
        `Found ${mongoTerms.length} index-aware terms in MongoDB for index: ${indexName}`,
      );

      if (mongoTerms.length > 0) {
        this.logger.debug(`Sample MongoDB terms: ${mongoTerms.slice(0, 5).join(', ')}`);
        // Also check for network terms specifically
        const networkTerms = mongoTerms.filter(term => term.includes('network'));
        this.logger.debug(`Network-related terms found: ${networkTerms.length}`);
        if (networkTerms.length > 0) {
          this.logger.debug(`Sample network terms: ${networkTerms.slice(0, 3).join(', ')}`);
        }
      }

      return mongoTerms;
    } catch (error) {
      this.logger.error(`Failed to get terms for index ${indexName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get posting list for a specific index-aware term from MongoDB storage
   */
  private async getPostingListByIndexAwareTerm(
    indexAwareTerm: string,
  ): Promise<PostingList | null> {
    try {
      this.logger.debug(`Looking up posting list for index-aware term: ${indexAwareTerm}`);
      const termPosting = await this.termPostingsRepository.findByIndexAwareTerm(indexAwareTerm);
      if (!termPosting) {
        this.logger.debug(`No term posting found in MongoDB for: ${indexAwareTerm}`);
        return null;
      }

      this.logger.debug(
        `Found term posting for: ${indexAwareTerm} with ${
          Object.keys(termPosting.postings).length
        } documents`,
      );
      const postingList = new SimplePostingList();
      for (const [docId, posting] of Object.entries(termPosting.postings)) {
        postingList.addEntry({
          docId,
          frequency: posting.frequency,
          positions: posting.positions || [],
          metadata: posting.metadata || {},
        });
      }

      this.logger.debug(
        `Created posting list for: ${indexAwareTerm} with ${postingList.size()} entries`,
      );
      return postingList;
    } catch (error) {
      this.logger.error(
        `Failed to get posting list for index-aware term ${indexAwareTerm}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Index-aware term lookup with fallback to MongoDB
   */
  private async getIndexAwareTermPostings(
    indexName: string,
    term: string,
    useExactMatch = true,
  ): Promise<Array<{ term: string; postingList: PostingList }>> {
    const results: Array<{ term: string; postingList: PostingList }> = [];

    // First try index-aware lookup
    this.logger.debug(`[DEBUG] Trying in-memory lookup for term: ${term} in index: ${indexName}`);
    const postingList = await this.termDictionary.getPostingListForIndex(indexName, term);
    this.logger.debug(
      `[DEBUG] In-memory result: found=${!!postingList}, size=${
        postingList ? postingList.size() : 'null'
      }`,
    );

    if (postingList && postingList.size() > 0) {
      this.logger.debug(
        `[DEBUG] Using in-memory posting list for term: ${term} in index: ${indexName} with ${postingList.size()} entries`,
      );
      results.push({ term, postingList });
      return results;
    }
    this.logger.debug(
      `[DEBUG] Skipping empty/null in-memory result, trying MongoDB fallback for term: ${term} in index: ${indexName}`,
    );

    // Fallback to MongoDB-based term lookup using index-aware term
    const indexAwareTerm = `${indexName}:${term}`;
    this.logger.debug(`Fallback to MongoDB for index-aware term: ${indexAwareTerm}`);
    const mongoPostingList = await this.getPostingListByIndexAwareTerm(indexAwareTerm);
    if (mongoPostingList && mongoPostingList.size() > 0) {
      this.logger.debug(
        `Found MongoDB posting list for term: ${term} in index: ${indexName} with ${mongoPostingList.size()} entries`,
      );
      results.push({ term, postingList: mongoPostingList });
      return results;
    }

    // If exact match didn't work and we allow pattern matching
    if (!useExactMatch) {
      const allTerms = await this.getTermsByIndex(indexName);
      const matchingTerms = allTerms.filter(t => t === term || t.startsWith(term));

      this.logger.debug(
        `Found ${matchingTerms.length} matching terms for pattern: ${term} in index: ${indexName}`,
      );

      for (const matchingTerm of matchingTerms) {
        // Use the index-aware term directly - no conversion needed
        const matchingPostingList = await this.getPostingListByIndexAwareTerm(matchingTerm);
        if (matchingPostingList && matchingPostingList.size() > 0) {
          this.logger.debug(
            `Found posting list for matching term: ${matchingTerm} with ${matchingPostingList.size()} entries`,
          );
          results.push({ term: matchingTerm, postingList: matchingPostingList });
        }
      }
    }

    return results;
  }

  private async executeTermStep(
    indexName: string,
    step: TermQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    // Get the analyzer for the field
    const analyzer = this.analyzerRegistry.getAnalyzer('standard');
    if (!analyzer) {
      throw new Error('Standard analyzer not found');
    }

    // Analyze the term to get normalized tokens
    const analyzedTerms = analyzer.analyze(step.term);
    if (!analyzedTerms || analyzedTerms.length === 0) {
      this.logger.debug(`No terms found after analysis for: ${step.term}`);
      return [];
    }

    const results: Array<{ id: string; score: number }> = [];

    // Process each analyzed term using index-aware lookup
    for (const analyzedTerm of analyzedTerms) {
      const fieldTerm = `${step.field}:${analyzedTerm}`;
      this.logger.debug(`Executing term step for field term: ${fieldTerm} in index: ${indexName}`);

      // Use index-aware term dictionary lookup
      const termResults = await this.getIndexAwareTermPostings(indexName, fieldTerm, true);

      for (const { term, postingList } of termResults) {
        if (postingList && postingList.size() > 0) {
          this.logger.debug(
            `Found posting list with ${postingList.size()} entries for field term: ${term} in index: ${indexName}`,
          );
          const scores = this.calculateScores(indexName, postingList, term);
          results.push(...scores);
        } else {
          this.logger.debug(`No posting list found for field term: ${term} in index: ${indexName}`);
        }
      }
    }

    return results;
  }

  private async executeBooleanStep(
    indexName: string,
    step: BooleanQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    // Execute each child step
    const resultsPromises = step.steps.map(childStep =>
      this.executeQueryStep(indexName, childStep),
    );
    const results = await Promise.all(resultsPromises);

    // Combine results based on the boolean operator
    if (step.operator === 'and') {
      return this.intersectResults(results);
    } else if (step.operator === 'or') {
      return this.unionResults(results);
    } else if (step.operator === 'not') {
      // NOT needs a left and right operand
      if (results.length < 2) return [];

      return this.subtractResults(results[0], results[1]);
    }

    return [];
  }

  private async executePhraseStep(
    indexName: string,
    step: PhraseQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    // Get postings for each term in the phrase using index-aware lookup
    const termPostings = await Promise.all(
      step.terms.map(async term => ({
        term,
        postings: await this.termDictionary.getPostingListForIndex(
          indexName,
          `${step.field}:${term}`,
        ),
      })),
    );

    // Check if all terms exist
    if (termPostings.some(tp => !tp.postings || tp.postings.size() === 0)) {
      return [];
    }

    // Find documents where the phrase occurs (terms in correct positions)
    const matchingDocs = this.findPhraseMatches(termPostings, step.positions || []);

    // Calculate scores for matching documents
    return this.calculatePhaseScores(indexName, matchingDocs, termPostings);
  }

  private async executeWildcardStep(
    indexName: string,
    step: WildcardQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    const { pattern, field, compiledPattern } = step;

    this.logger.debug(`Executing wildcard query: ${pattern} on field: ${field}`);
    this.logger.debug(`Compiled pattern: ${compiledPattern}`);
    this.logger.debug(`Pattern source: ${compiledPattern.source}, flags: ${compiledPattern.flags}`);

    // Test the pattern against some sample values
    const testValues = ['network', 'networking', 'net', 'networks', 'node'];
    this.logger.debug(`Testing pattern against samples:`);
    testValues.forEach(val => {
      const matches = compiledPattern.test(val);
      this.logger.debug(`  "${val}" matches: ${matches}`);
    });

    // Extract the base pattern without wildcards for prefix matching
    const basePattern = pattern.replace(/[*?]/g, '');

    // For simple prefix wildcards like "video*", use the fallback mechanism directly
    if (pattern.endsWith('*') && !pattern.includes('?') && basePattern.length > 0) {
      this.logger.debug(`Using direct fallback approach for simple prefix wildcard: ${pattern}`);

      // Get all terms from the index (index-aware)
      const allTerms = await this.getTermsByIndex(indexName);
      this.logger.debug(`Total terms available in index ${indexName}: ${allTerms.length}`);

      // Filter terms to match the field and pattern using index-aware format
      const matchingTerms = allTerms.filter(term => {
        // Parse index-aware term: index:field:termValue
        const parts = term.split(':');
        if (parts.length < 3) return false; // Should be index:field:term format

        const termIndexName = parts[0];
        const termField = parts[1];
        const termValue = parts.slice(2).join(':'); // Handle terms with colons

        // Check if it's for the correct index
        if (termIndexName !== indexName) return false;

        // Check field match (if field is specified and not _all)
        const fieldMatches = !field || field === '_all' || termField === field;
        if (!fieldMatches) return false;

        // Check pattern match
        const patternMatches = termValue && compiledPattern.test(termValue);

        this.logger.debug(
          `Term: ${term}, Field: ${termField}, Value: ${termValue}, FieldMatch: ${fieldMatches}, PatternMatch: ${patternMatches}`,
        );

        return patternMatches;
      });

      this.logger.debug(
        `Found ${matchingTerms.length} matching terms for pattern: ${pattern} on field: ${field} in index: ${indexName}`,
      );

      if (matchingTerms.length === 0) {
        this.logger.debug(
          `No wildcard matches found for pattern: ${pattern} in index: ${indexName}`,
        );
        return [];
      }

      // Get posting lists for all matching terms using index-aware lookup
      const results = await Promise.all(
        matchingTerms.map(async fullTerm => {
          // Extract field:term from index-aware term (index:field:term -> field:term)
          const parts = fullTerm.split(':');
          const fieldTerm = parts.slice(1).join(':'); // Remove index prefix

          // Try index-aware lookup first
          let postingList = await this.termDictionary.getPostingListForIndex(
            indexName,
            fieldTerm,
            false, // isIndexAware = false (we'll let it create the index-aware term)
          );

          // If not found in memory or empty, try MongoDB directly using full index-aware term
          if (!postingList || postingList.size() === 0) {
            postingList = await this.getPostingListByIndexAwareTerm(fullTerm);
          }

          if (!postingList) {
            this.logger.debug(`No posting list found for term: ${fullTerm}`);
            return [];
          }

          this.logger.debug(
            `Found posting list for term: ${fullTerm} with ${postingList.size()} documents`,
          );
          return this.calculateScores(indexName, postingList, fullTerm);
        }),
      );

      // Merge and deduplicate results
      return this.mergeWildcardScores(results.flat());
    }

    // Fallback to general wildcard processing
    this.logger.debug(`Using general wildcard processing for pattern: ${pattern}`);

    const fieldTerm = field && field !== '_all' ? `${field}:${basePattern}` : basePattern;
    const termResults = await this.getIndexAwareTermPostings(indexName, fieldTerm, false);

    if (termResults.length === 0) {
      this.logger.debug(`No wildcard matches found for pattern: ${pattern} in index: ${indexName}`);
      return [];
    }

    // Calculate scores for all matched terms
    const allResults: Array<{ id: string; score: number }> = [];
    for (const { term, postingList } of termResults) {
      const scores = this.calculateScores(indexName, postingList, term);
      allResults.push(...scores);
    }

    return this.mergeWildcardScores(allResults);
  }

  private async executeMatchAllStep(
    indexName: string,
    step: MatchAllQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    this.logger.debug(`Executing match-all query with boost: ${step.boost}`);

    // Get all documents in the index
    const result = await this.documentStorage.getDocuments(indexName, {
      limit: 100000, // Get all documents
    });

    // Return all documents with uniform score (boosted)
    const baseScore = step.boost || 1.0;

    return result.documents.map(doc => ({
      id: doc.documentId,
      score: baseScore,
    }));
  }

  /**
   * Merge scores from multiple terms for wildcard queries
   */
  private mergeWildcardScores(
    scores: Array<{ id: string; score: number }>,
  ): Array<{ id: string; score: number }> {
    const mergedScores = new Map<string, number>();

    // Sum scores for documents that appear in multiple terms
    for (const { id, score } of scores) {
      const existingScore = mergedScores.get(id) || 0;
      mergedScores.set(id, existingScore + score);
    }

    return Array.from(mergedScores.entries()).map(([id, score]) => ({ id, score }));
  }

  private calculateScores(
    indexName: string,
    postingList: PostingList,
    term: string,
  ): Array<{ id: string; score: number }> {
    const totalDocs = this.indexStats.totalDocuments;
    const docFreq = postingList.size();
    const field = term.split(':')[0];
    const avgFieldLength = this.indexStats.getAverageFieldLength(field);

    const k1 = 1.2;
    const b = 0.75;

    // BM25 calculation
    return postingList.getEntries().map(posting => {
      const tf = posting.frequency;
      const docLength = posting.positions.length;

      // BM25 formula
      const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgFieldLength));
      const score = idf * (numerator / denominator);

      return {
        id: posting.docId.toString(),
        score,
      };
    });
  }

  private calculatePhaseScores(
    indexName: string,
    matchingDocs: string[],
    termPostings: Array<{ term: string; postings: PostingList }>,
  ): Array<{ id: string; score: number }> {
    // For phrase queries, we can boost the score to prioritize them
    return matchingDocs.map(docId => {
      let totalScore = 0;

      // Calculate score for each term and sum them
      for (const { term, postings } of termPostings) {
        const posting = postings.getEntry(docId);
        if (posting) {
          const termScore = this.calculateTermScore(indexName, term, posting);
          totalScore += termScore;
        }
      }

      // Apply phrase boost
      totalScore *= 1.5;

      return {
        id: docId,
        score: totalScore,
      };
    });
  }

  private calculateTermScore(indexName: string, term: string, posting: any): number {
    const totalDocs = this.indexStats.totalDocuments;
    const docFreq = this.indexStats.getDocumentFrequency(term);
    const field = term.split(':')[0];
    const avgFieldLength = this.indexStats.getAverageFieldLength(field);

    const k1 = 1.2;
    const b = 0.75;

    const tf = posting.frequency;
    const docLength = posting.positions.length;

    // BM25 formula
    const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / avgFieldLength));

    return idf * (numerator / denominator);
  }

  private findPhraseMatches(
    termPostings: Array<{ term: string; postings: PostingList }>,
    positions: number[],
  ): string[] {
    // Start with documents matching the first term
    const firstTermDocs = new Set(
      termPostings[0].postings.getEntries().map(p => p.docId.toString()),
    );

    // Filter to documents that match all terms
    let candidateDocs = [...firstTermDocs];
    for (let i = 1; i < termPostings.length; i++) {
      const termDocs = new Set(termPostings[i].postings.getEntries().map(p => p.docId.toString()));
      candidateDocs = candidateDocs.filter(docId => termDocs.has(docId));
    }

    // Check for phrase matches (terms in the right positions)
    return candidateDocs.filter(docId => {
      // Get positions for each term in this document
      const termPositionsInDoc = termPostings.map(tp => {
        const posting = tp.postings.getEntry(docId);
        return posting ? posting.positions : [];
      });

      // Check if the phrase appears (terms in sequence)
      return this.hasPhrase(termPositionsInDoc, positions);
    });
  }

  private hasPhrase(termPositionsInDoc: number[][], expectedPositions: number[]): boolean {
    // For simple case where terms should be adjacent
    if (!expectedPositions || expectedPositions.length === 0) {
      return this.hasAdjacentTerms(termPositionsInDoc);
    }

    // For cases with specific position requirements
    // This is more complex and depends on your position encoding scheme
    return this.hasTermsAtPositions(termPositionsInDoc, expectedPositions);
  }

  private hasAdjacentTerms(termPositionsInDoc: number[][]): boolean {
    if (termPositionsInDoc.length === 0) return false;

    const firstTermPositions = termPositionsInDoc[0];

    // Try each position of the first term as a potential start
    for (const startPos of firstTermPositions) {
      let validPhrase = true;

      // Check if following terms appear in sequence
      for (let i = 1; i < termPositionsInDoc.length; i++) {
        const expectedPos = startPos + i;
        if (!termPositionsInDoc[i].includes(expectedPos)) {
          validPhrase = false;
          break;
        }
      }

      if (validPhrase) return true;
    }

    return false;
  }

  private hasTermsAtPositions(
    termPositionsInDoc: number[][],
    expectedPositions: number[],
  ): boolean {
    // Implementation depends on how you encode positions and expected relationships
    // This is a simplified version
    if (termPositionsInDoc.length === 0) return false;

    const firstTermPositions = termPositionsInDoc[0];

    for (const startPos of firstTermPositions) {
      let validPhrase = true;

      for (let i = 1; i < termPositionsInDoc.length; i++) {
        const expectedPos = startPos + expectedPositions[i] - expectedPositions[0];
        if (!termPositionsInDoc[i].includes(expectedPos)) {
          validPhrase = false;
          break;
        }
      }

      if (validPhrase) return true;
    }

    return false;
  }

  private intersectResults(
    results: Array<Array<{ id: string; score: number }>>,
  ): Array<{ id: string; score: number }> {
    if (results.length === 0) return [];
    if (results.length === 1) return results[0];

    // Convert first result to map for O(1) lookup
    const firstResultMap = new Map(results[0].map(r => [r.id, r.score]));

    // Find documents that exist in all results
    const commonDocs = results.slice(1).reduce((common, current) => {
      const currentMap = new Map(current.map(r => [r.id, r.score]));
      return common
        .filter(doc => currentMap.has(doc.id))
        .map(doc => ({
          id: doc.id,
          // Combine scores - for AND we multiply normalized scores
          score: doc.score * (currentMap.get(doc.id) || 0),
        }));
    }, results[0]);

    return commonDocs;
  }

  private unionResults(
    results: Array<Array<{ id: string; score: number }>>,
  ): Array<{ id: string; score: number }> {
    if (results.length === 0) return [];
    if (results.length === 1) return results[0];

    // Combine all results, summing scores for duplicate documents
    const scoreMap = new Map<string, number>();
    results.flat().forEach(result => {
      const currentScore = scoreMap.get(result.id) || 0;
      scoreMap.set(result.id, currentScore + result.score);
    });

    return Array.from(scoreMap.entries()).map(([id, score]) => ({ id, score }));
  }

  private subtractResults(
    left: Array<{ id: string; score: number }>,
    right: Array<{ id: string; score: number }>,
  ): Array<{ id: string; score: number }> {
    // Convert right result to set for O(1) lookup
    const rightIds = new Set(right.map(r => r.id));

    // Return documents from left that don't exist in right
    return left.filter(doc => !rightIds.has(doc.id));
  }

  private sortMatches(
    matches: Array<{ id: string; score: number }>,
    sort?: string,
  ): Array<{ id: string; score: number }> {
    if (!sort) {
      // Default sort by score descending
      return [...matches].sort((a, b) => b.score - a.score);
    }

    // Implement custom sorting logic based on the sort parameter
    // This would require having document fields available
    // For now, we'll just return score-sorted results
    return [...matches].sort((a, b) => b.score - a.score);
  }

  private async applyFilters(
    matches: SearchMatch[],
    filter: Record<string, any>,
    indexName: string,
  ): Promise<SearchMatch[]> {
    if (!filter || !matches.length) {
      return matches;
    }

    // Get documents for filtering
    const documents = await this.fetchDocuments(
      indexName,
      matches.map(m => m.id),
    );

    // Apply term filter
    if (filter.term) {
      const { field, value } = filter.term;
      return matches.filter(match => {
        const doc = documents[match.id];
        if (!doc) return false;

        const fieldValue = doc[field];

        // Handle array fields (like categories)
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(value);
        }

        // Handle scalar fields
        return fieldValue === value;
      });
    }

    // Add support for other filter types here (range, exists, etc.)
    return matches;
  }

  private async fetchDocuments(indexName: string, docIds: string[]): Promise<Record<string, any>> {
    const documents: Record<string, any> = {};

    this.logger.debug(`Fetching documents for IDs: ${JSON.stringify(docIds)}`);

    // Fetch documents in batch for efficiency
    const result = await this.documentStorage.getDocuments(indexName, {
      filter: {
        documentId: {
          $in: docIds,
        },
      },
    });

    this.logger.debug(`Found ${result.documents.length} documents`);

    // Index by ID for easy lookup
    result.documents.forEach(doc => {
      documents[doc.documentId] = doc.content;
    });

    return documents;
  }

  private getMatchingTerms(term: string): string[] {
    const allTerms = this.termDictionary.getTerms();
    return allTerms.filter(t => t.startsWith(term));
  }
}
