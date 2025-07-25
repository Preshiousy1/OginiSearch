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
import { TermDictionary } from '../index/term-dictionary';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';
import { SimplePostingList } from '../index/posting-list';

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
    private readonly termDictionary: TermDictionary,
    private readonly documentStorage: DocumentStorageService,
    private readonly indexStats: IndexStatsService,
    private readonly analyzerRegistry: AnalyzerRegistryService,
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
   * Get terms for a specific index from in-memory dictionary
   */
  private async getTermsByIndex(indexName: string): Promise<string[]> {
    try {
      const allTerms = this.termDictionary.getTerms();
      const memoryTerms = allTerms.filter(term => term.startsWith(`${indexName}:`));
      this.logger.debug(`Found ${memoryTerms.length} terms in memory for index: ${indexName}`);
      if (memoryTerms.length > 0) {
        this.logger.debug(`Sample memory terms: ${memoryTerms.slice(0, 5).join(', ')}`);
      }
      return memoryTerms;
    } catch (error) {
      this.logger.error(`Failed to get terms for index ${indexName}: ${error.message}`);
      return [];
    }
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

    // Process each analyzed term
    for (const analyzedTerm of analyzedTerms) {
      const fieldTerm = `${indexName}:${step.field}:${analyzedTerm}`;
      this.logger.debug(`Executing term step for field term: ${fieldTerm} in index: ${indexName}`);

      // Get posting list from term dictionary
      const postings = this.termDictionary.getPostings(fieldTerm);
      let postingList: SimplePostingList | undefined;
      if (postings) {
        postingList = new SimplePostingList();
        for (const [docId, positions] of postings.entries()) {
          postingList.addEntry({ docId, positions, frequency: positions.length });
        }
      }

      if (postingList && postingList.size() > 0) {
        this.logger.debug(
          `Found posting list with ${postingList.size()} entries for field term: ${fieldTerm} in index: ${indexName}`,
        );
        const scores = this.calculateScores(indexName, postingList, fieldTerm);
        results.push(...scores);
      } else {
        this.logger.debug(
          `No posting list found for field term: ${fieldTerm} in index: ${indexName}`,
        );
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
      step.terms.map(async term => {
        const fieldTerm = `${indexName}:${step.field}:${term}`;
        const postings = this.termDictionary.getPostings(fieldTerm);
        let postingList: SimplePostingList | undefined;
        if (postings) {
          postingList = new SimplePostingList();
          for (const [docId, positions] of postings.entries()) {
            postingList.addEntry({ docId, positions, frequency: positions.length });
          }
        }
        return {
          term,
          postings: postingList,
        };
      }),
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

    // Extract the base pattern without wildcards for prefix matching
    const basePattern = pattern.replace(/[*?]/g, '');

    // For simple prefix wildcards like "video*", use prefix matching
    if (pattern.endsWith('*') && !pattern.includes('?') && basePattern.length > 0) {
      this.logger.debug(`Using prefix matching for simple wildcard: ${pattern}`);

      // Get all terms from the index
      const allTerms = await this.getTermsByIndex(indexName);
      this.logger.debug(`Total terms available in index ${indexName}: ${allTerms.length}`);

      // Filter terms to match the field and pattern
      const matchingTerms = allTerms.filter(term => {
        const parts = term.split(':');
        if (parts.length < 3) return false;

        const termIndexName = parts[0];
        const termField = parts[1];
        const termValue = parts.slice(2).join(':');

        if (termIndexName !== indexName) return false;
        if (field && field !== '_all' && termField !== field) return false;

        return termValue && compiledPattern.test(termValue);
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

      // Get posting lists for all matching terms
      const results = await Promise.all(
        matchingTerms.map(async fullTerm => {
          const parts = fullTerm.split(':');
          const fieldTerm = parts.slice(1).join(':');

          const postings = this.termDictionary.getPostings(fieldTerm);
          let postingList: SimplePostingList | undefined;
          if (postings) {
            postingList = new SimplePostingList();
            for (const [docId, positions] of postings.entries()) {
              postingList.addEntry({ docId, positions, frequency: positions.length });
            }
          }

          if (!postingList || postingList.size() === 0) {
            this.logger.debug(`No posting list found for term: ${fullTerm}`);
            return [];
          }

          this.logger.debug(
            `Found posting list for term: ${fullTerm} with ${postingList.size()} documents`,
          );
          return this.calculateScores(indexName, postingList, fullTerm);
        }),
      );

      return this.mergeWildcardScores(results.flat());
    }

    // Fallback to general wildcard processing
    this.logger.debug(`Using general wildcard processing for pattern: ${pattern}`);

    const fieldTerm = field && field !== '_all' ? `${field}:${basePattern}` : basePattern;
    const postings = this.termDictionary.getPostings(fieldTerm);
    let postingList: SimplePostingList | undefined;
    if (postings) {
      postingList = new SimplePostingList();
      for (const [docId, positions] of postings.entries()) {
        postingList.addEntry({ docId, positions, frequency: positions.length });
      }
    }

    if (!postingList || postingList.size() === 0) {
      this.logger.debug(`No wildcard matches found for pattern: ${pattern} in index: ${indexName}`);
      return [];
    }

    return this.calculateScores(indexName, postingList, fieldTerm);
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
