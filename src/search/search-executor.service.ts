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
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { FieldMapping } from '../index/interfaces/index.interface';

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

  // Cache for field boost values per index (to avoid repeated lookups)
  private fieldBoostCache: Map<string, Record<string, number>> = new Map();
  // In-flight promise per index to prevent cache stampede (concurrent getFieldBoosts for same index)
  private fieldBoostLoadPromise: Map<string, Promise<Record<string, number>>> = new Map();

  /**
   * Clear cached field boosts for an index (or all). Call after index mappings are updated
   * so that the next search uses the new boost values.
   */
  clearFieldBoostCache(indexName?: string): void {
    if (indexName) {
      this.fieldBoostCache.delete(indexName);
      this.fieldBoostLoadPromise.delete(indexName);
      this.logger.debug(`Cleared field boost cache for index: ${indexName}`);
    } else {
      this.fieldBoostCache.clear();
      this.fieldBoostLoadPromise.clear();
      this.logger.debug('Cleared all field boost cache');
    }
  }

  constructor(
    @Inject('TERM_DICTIONARY')
    private readonly termDictionary: InMemoryTermDictionary,
    private readonly documentStorage: DocumentStorageService,
    private readonly indexStats: IndexStatsService,
    private readonly analyzerRegistry: AnalyzerRegistryService,
    private readonly termPostingsRepository: TermPostingsRepository,
    private readonly indexStorage: IndexStorageService,
  ) {}

  async executeQuery(
    indexName: string,
    executionPlan: QueryExecutionPlan,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    this.logger.debug(`Executing query plan for index: ${indexName}`);

    // Preload field boosts once so parallel term scoring doesn't trigger duplicate storage lookups
    await this.getFieldBoosts(indexName);

    // Default values for search options
    const { from = 0, size = 10, sort, filter } = options;
    if (filter != null && Object.keys(filter).length > 0) {
      this.logger.debug(`Search options include filter: ${JSON.stringify(filter)}`);
    }

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
   * Get terms for a specific index from MongoDB storage.
   * When valuePrefix is set (e.g. "car" for wildcard "car*"), only terms whose value part
   * starts with that prefix are returned — avoids loading 200k+ terms for one wildcard.
   * REDIS-RESILIENT: Falls back to MongoDB if Redis/memory fails.
   */
  private async getTermsByIndex(indexName: string, valuePrefix?: string): Promise<string[]> {
    try {
      let memoryTerms: string[] = [];
      try {
        memoryTerms = this.termDictionary.getTermsForIndex(indexName);
        this.logger.debug(`Found ${memoryTerms.length} terms in memory for index: ${indexName}`);
        if (memoryTerms.length > 0 && !valuePrefix) {
          return memoryTerms;
        }
        if (memoryTerms.length > 0 && valuePrefix) {
          const prefix = `${indexName}:`;
          const re = new RegExp(
            `^${prefix}[^:]+:${valuePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          );
          const filtered = memoryTerms.filter(t => re.test(t));
          this.logger.debug(
            `Filtered in-memory terms by prefix "${valuePrefix}": ${filtered.length}/${memoryTerms.length}`,
          );
          // Only use in-memory result if we found matches; otherwise fall back to MongoDB.
          // In-memory may have a subset of terms (e.g. "car*" from a prior query); a "job*"
          // search would get 0 matches and must query MongoDB for job-prefixed terms.
          if (filtered.length > 0) {
            return filtered;
          }
        }
      } catch (error) {
        this.logger.warn(`Memory term lookup failed for ${indexName}: ${error.message}`);
      }

      this.logger.debug(
        `Falling back to MongoDB for terms in index and value prefix: ${indexName}${
          valuePrefix ? ` (valuePrefix=${valuePrefix})` : ''
        }`,
      );
      const mongoTerms = valuePrefix
        ? await this.termPostingsRepository.findTermKeysByIndexAndValuePrefix(
            indexName,
            valuePrefix,
          )
        : [
            ...new Set(
              (await this.termPostingsRepository.findByIndex(indexName)).map(tp => tp.term),
            ),
          ];
      this.logger.debug(
        `Found ${mongoTerms.length} index-aware terms in MongoDB for index: ${indexName}`,
      );
      if (mongoTerms.length > 0 && mongoTerms.length <= 10) {
        this.logger.debug(`Sample MongoDB terms: ${mongoTerms.slice(0, 5).join(', ')}`);
      }
      return mongoTerms;
    } catch (error) {
      this.logger.error(`Failed to get terms for index ${indexName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get posting list for a specific index-aware term from MongoDB (chunked model; merged on read).
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
        `Found term posting for: ${indexAwareTerm} with ${termPosting.documentCount} documents`,
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

    const indexAwareTerm = `${indexName}:${term}`;

    // In-memory may have a stale partial list (e.g. one batch's worth after bulk indexing).
    // Always check MongoDB too and use the larger list so search sees the full persisted data.
    this.logger.debug(`[DEBUG] Looking up term: ${term} in index: ${indexName}`);
    const memoryList = await this.termDictionary.getPostingListForIndex(indexName, term);
    const mongoPostingList = await this.getPostingListByIndexAwareTerm(indexAwareTerm);

    const memorySize = memoryList?.size() ?? 0;
    const mongoSize = mongoPostingList?.size() ?? 0;

    if (mongoSize > memorySize) {
      this.logger.debug(
        `Using MongoDB posting list for ${term} (${mongoSize} entries; memory had ${memorySize})`,
      );
      results.push({ term, postingList: mongoPostingList! });
      return results;
    }
    if (memoryList && memorySize > 0) {
      this.logger.debug(`Using in-memory posting list for ${term} (${memorySize} entries)`);
      results.push({ term, postingList: memoryList });
      return results;
    }
    if (mongoPostingList && mongoSize > 0) {
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
          const scores = await this.calculateScores(indexName, postingList, term);
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
    return await this.calculatePhaseScores(indexName, matchingDocs, termPostings);
  }

  private async executeWildcardStep(
    indexName: string,
    step: WildcardQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    const { pattern, field, compiledPattern } = step;

    this.logger.debug(`Executing wildcard query: ${pattern} on field: ${field}`);

    // Extract the base pattern without wildcards (e.g. "smart*" -> "smart")
    const basePattern = pattern.replace(/[*?]/g, '');

    // For simple trailing-* wildcards (e.g. "smart*"), try keyword search on the prefix first
    // only when a specific field is targeted. For field _all, terms are stored per-field
    // (e.g. listings:name:car, listings:description:car), so a single lookup for "car" only
    // finds one kind of match; we must run full expansion to get all fields.
    if (pattern.endsWith('*') && !pattern.includes('?') && basePattern.length > 0) {
      const isAllFields = !field || field === '_all';
      if (!isAllFields) {
        const fieldTerm = `${field}:${basePattern}`;
        const prefixResults = await this.getIndexAwareTermPostings(indexName, fieldTerm, true);
        if (prefixResults.length > 0) {
          let hasAny = false;
          const scores: Array<{ id: string; score: number; field?: string }> = [];
          for (const { term, postingList } of prefixResults) {
            if (postingList && postingList.size() > 0) {
              hasAny = true;
              scores.push(...(await this.calculateScores(indexName, postingList, term)));
            }
          }
          if (hasAny && scores.length > 0) {
            this.logger.debug(
              `Wildcard ${pattern}: prefix keyword "${fieldTerm}" returned ${scores.length} hits; skipping full term scan`,
            );
            return await this.mergeWildcardScores(indexName, scores);
          }
        }
        this.logger.debug(
          `Wildcard ${pattern}: no results for prefix "${basePattern}" on field ${field}; scanning terms`,
        );
      } else {
        this.logger.debug(
          `Wildcard ${pattern}: field _all; scanning terms for pattern (no single-term shortcut)`,
        );
      }

      // Use value prefix when possible so MongoDB returns only matching terms (~380 vs 228k)
      const allTerms = await this.getTermsByIndex(indexName, basePattern);
      this.logger.debug(`Terms for pattern ${pattern}: ${allTerms.length}`);

      // Filter without per-term logging (was causing thousands of debug lines and slowdown)
      const matchingTerms = allTerms.filter(term => {
        const parts = term.split(':');
        if (parts.length < 3) return false;
        const termIndexName = parts[0];
        const termField = parts[1];
        const termValue = parts.slice(2).join(':');
        if (termIndexName !== indexName) return false;
        const fieldMatches = !field || field === '_all' || termField === field;
        if (!fieldMatches) return false;
        return !!(termValue && compiledPattern.test(termValue));
      });

      this.logger.debug(
        `Found ${matchingTerms.length} matching terms for pattern: ${pattern} on field: ${field}`,
      );

      if (matchingTerms.length === 0) {
        this.logger.debug(
          `No wildcard matches found for pattern: ${pattern} in index: ${indexName}`,
        );
        return [];
      }

      // Get posting lists for matching terms (no per-term logging to avoid slowdown)
      const results = await Promise.all(
        matchingTerms.map(async fullTerm => {
          const parts = fullTerm.split(':');
          const fieldTerm = parts.slice(1).join(':');
          let postingList = await this.termDictionary.getPostingListForIndex(
            indexName,
            fieldTerm,
            false,
          );
          if (!postingList || postingList.size() === 0) {
            postingList = await this.getPostingListByIndexAwareTerm(fullTerm);
          }
          if (!postingList) return [];
          return this.calculateScores(indexName, postingList, fullTerm);
        }),
      );
      const allScores = (await Promise.all(results)).flat();
      return await this.mergeWildcardScores(indexName, allScores);
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
    const allResults: Array<{ id: string; score: number; field?: string }> = [];
    for (const { term, postingList } of termResults) {
      const scores = await this.calculateScores(indexName, postingList, term);
      allResults.push(...scores);
    }

    return await this.mergeWildcardScores(indexName, allResults);
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
  /**
   * Merge scores from multiple terms/fields for wildcard/_all queries
   * Note: Scores already have field boost applied from calculateScores(),
   * so we just sum them here (no double-boosting)
   */
  private async mergeWildcardScores(
    indexName: string,
    scores: Array<{ id: string; score: number; field?: string }>,
  ): Promise<Array<{ id: string; score: number }>> {
    const mergedScores = new Map<string, number>();

    // Sum scores for documents that appear in multiple terms/fields
    // Scores already have field boost applied from calculateScores()
    for (const { id, score } of scores) {
      const existingScore = mergedScores.get(id) || 0;
      mergedScores.set(id, existingScore + score);
    }

    return Array.from(mergedScores.entries()).map(([id, score]) => ({ id, score }));
  }

  /**
   * Get field boost values from index mappings (cached).
   * Uses single-flight: concurrent calls for the same index share one load to avoid N duplicate
   * storage round-trips (was causing ~23s search when 7 terms each triggered getIndex).
   */
  private async getFieldBoosts(indexName: string): Promise<Record<string, number>> {
    // 1. Return sync cache if present
    const cached = this.fieldBoostCache.get(indexName);
    if (cached) {
      return cached;
    }

    // 2. Join in-flight load for this index (avoids cache stampede)
    let loadPromise = this.fieldBoostLoadPromise.get(indexName);
    if (!loadPromise) {
      loadPromise = this.loadFieldBoostsIntoCache(indexName);
      this.fieldBoostLoadPromise.set(indexName, loadPromise);
      loadPromise.finally(() => this.fieldBoostLoadPromise.delete(indexName));
    }
    return loadPromise;
  }

  /**
   * Load field boosts from storage and cache. Called once per index per search (single-flight).
   */
  private async loadFieldBoostsIntoCache(indexName: string): Promise<Record<string, number>> {
    try {
      const index = await this.indexStorage.getIndex(indexName);
      const fieldBoosts: Record<string, number> = {};

      if (index?.mappings?.properties) {
        const extractBoost = (mapping: FieldMapping, fieldPath: string): void => {
          fieldBoosts[fieldPath] = mapping.boost !== undefined ? mapping.boost : 1.0;
          if (mapping.fields) {
            for (const [nestedFieldName, nestedMapping] of Object.entries(mapping.fields)) {
              extractBoost(nestedMapping, `${fieldPath}.${nestedFieldName}`);
            }
          }
        };
        for (const [fieldName, fieldMapping] of Object.entries(index.mappings.properties)) {
          extractBoost(fieldMapping, fieldName);
        }
      }

      this.fieldBoostCache.set(indexName, fieldBoosts);
      if (Object.keys(fieldBoosts).length > 0) {
        this.logger.debug(
          `Loaded field boosts for index ${indexName}: ${JSON.stringify(fieldBoosts)}`,
        );
      }
      return fieldBoosts;
    } catch (error) {
      this.logger.warn(`Failed to load field boosts for index ${indexName}: ${error.message}`);
      return {};
    }
  }

  /**
   * Calculate BM25 scores for a posting list, applying field boost from index mappings
   */
  private async calculateScores(
    indexName: string,
    postingList: PostingList,
    term: string,
  ): Promise<Array<{ id: string; score: number; field?: string }>> {
    const totalDocs = this.indexStats.totalDocuments;
    const docFreq = postingList.size();
    const field = term.split(':')[0];
    const avgFieldLength = this.indexStats.getAverageFieldLength(field);

    // Get field boost from index mappings
    const fieldBoosts = await this.getFieldBoosts(indexName);
    const fieldBoost = fieldBoosts[field] || 1.0;

    const k1 = 1.2;
    const b = 0.75;

    // BM25 calculation with field boost applied
    return postingList.getEntries().map(posting => {
      const tf = posting.frequency;
      const docLength = posting.positions.length;

      // BM25 formula
      const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgFieldLength));
      const baseScore = idf * (numerator / denominator);

      // Apply field boost
      const score = baseScore * fieldBoost;

      return {
        id: posting.docId.toString(),
        score,
        field, // Include field for mergeWildcardScores
      };
    });
  }

  private async calculatePhaseScores(
    indexName: string,
    matchingDocs: string[],
    termPostings: Array<{ term: string; postings: PostingList }>,
  ): Promise<Array<{ id: string; score: number }>> {
    // Get field boosts for applying weights
    const fieldBoosts = await this.getFieldBoosts(indexName);

    // For phrase queries, we can boost the score to prioritize them
    return matchingDocs.map(docId => {
      let totalScore = 0;

      // Calculate score for each term and sum them
      for (const { term, postings } of termPostings) {
        const posting = postings.getEntry(docId);
        if (posting) {
          const termScore = this.calculateTermScore(indexName, term, posting, fieldBoosts);
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

  private calculateTermScore(
    indexName: string,
    term: string,
    posting: any,
    fieldBoosts: Record<string, number> = {},
  ): number {
    const field = term.split(':')[0];
    const fieldBoost = fieldBoosts[field] || 1.0;
    const totalDocs = this.indexStats.totalDocuments;
    const docFreq = this.indexStats.getDocumentFrequency(term);
    const avgFieldLength = this.indexStats.getAverageFieldLength(field);

    const k1 = 1.2;
    const b = 0.75;

    const tf = posting.frequency;
    const docLength = posting.positions.length;

    // BM25 formula
    const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / avgFieldLength));
    const baseScore = idf * (numerator / denominator);

    // Apply field boost
    return baseScore * fieldBoost;
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

  /**
   * Check if a document field value matches a term filter value.
   * Supports: exact match, boolean coercion (0/1 <-> false/true), array includes,
   * and (for strings) case-insensitive substring match.
   */
  private termFilterMatches(fieldValue: any, filterValue: any): boolean {
    if (Array.isArray(fieldValue)) {
      return fieldValue.includes(filterValue);
    }
    if (fieldValue === filterValue) {
      return true;
    }
    // Boolean coercion: Laravel/MySQL often store booleans as 0/1
    if (typeof filterValue === 'boolean') {
      const normalized = fieldValue === 1 || fieldValue === '1' || fieldValue === true;
      return normalized === filterValue;
    }
    // String contains: allow filter "Oyo" to match "Oyo State", "Ibadan, Oyo", etc.
    if (typeof fieldValue === 'string' && typeof filterValue === 'string') {
      return fieldValue.toLowerCase().includes(filterValue.toLowerCase());
    }
    return false;
  }

  private async applyFilters(
    matches: SearchMatch[],
    filter: Record<string, any>,
    indexName: string,
  ): Promise<SearchMatch[]> {
    if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) {
      return matches;
    }
    this.logger.debug(`Applying filter to ${matches.length} matches: ${JSON.stringify(filter)}`);

    // Get documents for filtering
    const documents = await this.fetchDocuments(
      indexName,
      matches.map(m => m.id),
    );

    // Supported: filter.bool.must (array of { term: { field, value } }) — AND all clauses
    if (filter.bool?.must && Array.isArray(filter.bool.must)) {
      const clauses = filter.bool.must.filter(
        (c: any) => c && c.term && c.term.field != null,
      ) as Array<{ term: { field: string; value: any } }>;
      if (clauses.length > 0) {
        let debugLogged = false;
        const filtered = matches.filter(match => {
          const doc = documents[match.id];
          if (!doc) return false;
          for (const { term } of clauses) {
            const { field, value } = term;
            const fieldValue = doc[field];
            const ok = this.termFilterMatches(fieldValue, value);
            if (!ok) {
              // Log first failure to help debug (e.g. 26->0 matches)
              if (!debugLogged) {
                this.logger.debug(
                  `Filter debug: doc ${match.id} failed on ${field}=${JSON.stringify(value)} ` +
                    `(got: ${JSON.stringify(fieldValue)}, type: ${typeof fieldValue})`,
                );
                debugLogged = true;
              }
              return false;
            }
          }
          return true;
        });
        this.logger.debug(
          `Filter.bool.must(${clauses.length} terms): ${matches.length} -> ${filtered.length} matches`,
        );
        return filtered;
      }
    }

    // Single term filter: { term: { field: string, value: any } }
    if (filter.term && filter.term.field != null) {
      const { field, value } = filter.term;
      const filtered = matches.filter(match => {
        const doc = documents[match.id];
        if (!doc) return false;
        const fieldValue = doc[field];
        return this.termFilterMatches(fieldValue, value);
      });
      this.logger.debug(
        `Filter.term(${field}=${value}): ${matches.length} -> ${filtered.length} matches`,
      );
      return filtered;
    }

    if (Object.keys(filter).length > 0) {
      const keys = Object.keys(filter).join(', ');
      this.logger.debug(
        `Filter present but no supported shape (filter.term or filter.bool.must). Keys: ${keys}`,
      );
    }
    return matches;
  }

  private async fetchDocuments(indexName: string, docIds: string[]): Promise<Record<string, any>> {
    const documents: Record<string, any> = {};

    this.logger.debug(`Fetching documents for ${docIds.length} IDs`);

    // Guard against extremely large ID lists (safety limit)
    const MAX_FETCH_LIMIT = 10_000;
    const fetchLimit = Math.min(docIds.length, MAX_FETCH_LIMIT);

    if (docIds.length > MAX_FETCH_LIMIT) {
      this.logger.warn(
        `Requested ${docIds.length} documents, but limiting to ${MAX_FETCH_LIMIT} for safety`,
      );
    }

    // Fetch documents in batch for efficiency
    // Pass limit: docIds.length to ensure all requested documents are returned
    // (repository defaults to limit: 100, which would cap results)
    const result = await this.documentStorage.getDocuments(indexName, {
      filter: {
        documentId: {
          $in: docIds,
        },
      },
      limit: fetchLimit,
      offset: 0,
    });

    this.logger.debug(
      `Found ${result.documents.length} documents (requested ${docIds.length}, limit was ${fetchLimit})`,
    );

    // Index by ID for easy lookup (MongoDB stores document body in 'content')
    result.documents.forEach(doc => {
      documents[doc.documentId] = doc.content;
    });

    // Fallback: for any IDs not found in MongoDB, try RocksDB processed-doc storage.
    // Bulk-indexed docs are always written to RocksDB by IndexingService; if they're
    // missing from MongoDB (e.g. storage path or timing), we still return source from RocksDB.
    const missingIds = docIds.filter(id => documents[id] == null);
    if (missingIds.length > 0) {
      this.logger.debug(
        `Fetching ${missingIds.length} documents from index storage fallback (missing from document storage)`,
      );
      await Promise.all(
        missingIds.map(async id => {
          const processed = await this.indexStorage.getProcessedDocument(indexName, id);
          if (processed?.source != null) {
            documents[id] = processed.source;
          }
        }),
      );
    }

    // Warn if we didn't get all requested documents from either source
    const stillMissing = docIds.filter(id => documents[id] == null).length;
    if (stillMissing > 0) {
      this.logger.warn(
        `Only retrieved ${docIds.length - stillMissing} of ${
          docIds.length
        } requested documents (${stillMissing} missing from both storage layers)`,
      );
    }

    return documents;
  }

  private getMatchingTerms(term: string): string[] {
    const allTerms = this.termDictionary.getTerms();
    return allTerms.filter(t => t.startsWith(term));
  }
}
