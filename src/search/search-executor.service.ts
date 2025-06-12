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

interface SearchMatch {
  id: string;
  score: number;
  index: string;
}

interface SearchOptions {
  from?: number;
  size?: number;
  sort?: string;
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
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
    private readonly documentStorage: DocumentStorageService,
    private readonly indexStats: IndexStatsService,
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
    }));

    // Apply any filter conditions if provided
    const filteredMatches = await this.applyFilters(matches, filter);

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
      document: documents[match.id] || {},
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
    // Get the root step of the plan
    const rootStep = plan.steps[0];

    // Execute the step recursively
    return this.executeStep(indexName, rootStep);
  }

  private async executeStep(
    indexName: string,
    step: QueryExecutionStep,
  ): Promise<Array<{ id: string; score: number }>> {
    if (step.type === 'term') {
      return this.executeTermStep(indexName, step as TermQueryStep);
    } else if (step.type === 'boolean') {
      return this.executeBooleanStep(indexName, step as BooleanQueryStep);
    } else if (step.type === 'phrase') {
      return this.executePhraseStep(indexName, step as PhraseQueryStep);
    } else if (step.type === 'wildcard') {
      return this.executeWildcardStep(indexName, step as WildcardQueryStep);
    } else if (step.type === 'match_all') {
      return this.executeMatchAllStep(indexName, step as MatchAllQueryStep);
    }

    return [];
  }

  /**
   * Reusable method to get postings for a term with fallback mechanism
   * This ensures consistent behavior between regular and wildcard searches
   */
  private async getTermPostings(
    term: string,
    useExactMatch = true,
  ): Promise<Array<{ term: string; postingList: PostingList }>> {
    const results: Array<{ term: string; postingList: PostingList }> = [];

    if (useExactMatch) {
      // Try exact match first
      const exactPostingList = await this.termDictionary.getPostingList(term);
      if (exactPostingList && exactPostingList.size() > 0) {
        this.logger.debug(
          `Found exact posting list for term: ${term} with ${exactPostingList.size()} entries`,
        );
        results.push({ term, postingList: exactPostingList });
        return results;
      }
    }

    // Fallback to matching terms (includes exact match + prefix matches)
    const allTerms = this.termDictionary.getTerms();
    this.logger.debug(`Total terms available in dictionary: ${allTerms.length}`);

    // Debug: check specifically for video-related terms
    const videoTerms = allTerms.filter(t => t.includes('video'));
    this.logger.debug(
      `Video-related terms in dictionary: ${JSON.stringify(videoTerms.slice(0, 10))}`,
    );

    // Debug: check if the exact term exists
    const exactTermExists = allTerms.includes(term);
    this.logger.debug(`Exact term "${term}" exists in dictionary: ${exactTermExists}`);

    const matchingTerms = allTerms.filter(t => t === term || t.startsWith(term));
    this.logger.debug(`Found ${matchingTerms.length} matching terms for: ${term}`);

    for (const matchingTerm of matchingTerms) {
      const postingList = await this.termDictionary.getPostingList(matchingTerm);
      if (postingList && postingList.size() > 0) {
        this.logger.debug(
          `Found posting list for matching term: ${matchingTerm} with ${postingList.size()} entries`,
        );
        results.push({ term: matchingTerm, postingList });
      }
    }

    return results;
  }

  private async executeTermStep(
    indexName: string,
    step: TermQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    const { term } = step;

    // Use the reusable method with exact match preference
    const termPostings = await this.getTermPostings(term, true);

    const allScores: Array<{ id: string; score: number }> = [];
    for (const { term: matchingTerm, postingList } of termPostings) {
      const scores = this.calculateScores(indexName, postingList, matchingTerm);
      allScores.push(...scores);
    }

    return allScores;
  }

  private async executeBooleanStep(
    indexName: string,
    step: BooleanQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    // Execute each child step
    const resultsPromises = step.steps.map(childStep => this.executeStep(indexName, childStep));
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
    // Get postings for each term in the phrase
    const termPostings = await Promise.all(
      step.terms.map(async term => ({
        term,
        postings: await this.termDictionary.getPostingList(`${step.field}:${term}`),
      })),
    );

    // Check if all terms exist
    if (termPostings.some(tp => !tp.postings || tp.postings.size() === 0)) {
      return [];
    }

    // Find documents where the phrase occurs (terms in correct positions)
    const matchingDocs = this.findPhraseMatches(termPostings, step.positions);

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

    // Extract the base pattern without wildcards for prefix matching
    const basePattern = pattern.replace(/[*?]/g, '');

    // For simple prefix wildcards like "video*", use the fallback mechanism directly
    // This works like regular search but filters results with the wildcard pattern
    if (pattern.endsWith('*') && !pattern.includes('?') && basePattern.length > 0) {
      this.logger.debug(`Using direct fallback approach for simple prefix wildcard: ${pattern}`);

      const fallbackTerm =
        field && field !== '_all' ? `${field}:${basePattern}` : `_all:${basePattern}`;
      this.logger.debug(`Looking for fallback term: ${fallbackTerm}`);

      // Use the same approach as regular term search with fallback
      const termPostings = await this.getTermPostings(fallbackTerm, true);

      if (termPostings.length > 0) {
        this.logger.debug(
          `Fallback found ${termPostings.length} term postings, filtering with pattern`,
        );

        // Filter the results with the wildcard pattern
        const filteredPostings = termPostings.filter(({ term }) => {
          const termParts = term.split(':');
          if (termParts.length >= 2) {
            const termValue = termParts.slice(1).join(':');
            const matches = compiledPattern && compiledPattern.test(termValue);
            this.logger.debug(`Term ${term} -> ${termValue} matches pattern: ${matches}`);
            return matches;
          }
          return false;
        });

        this.logger.debug(
          `After pattern filtering: ${filteredPostings.length} term postings remain`,
        );

        // Calculate scores from filtered results
        const allScores: Array<{ id: string; score: number }> = [];
        for (const { term, postingList } of filteredPostings) {
          const scores = this.calculateScores(indexName, postingList, term);
          allScores.push(...scores);
        }

        return this.mergeWildcardScores(allScores);
      }
    }

    // Fallback to the original implementation for complex patterns
    this.logger.debug(`Using original term dictionary approach for complex pattern: ${pattern}`);

    // Get all terms from the dictionary
    const allTerms = this.termDictionary.getTerms();
    this.logger.debug(`Total terms in dictionary: ${allTerms.length}`);

    // Debug: check specifically for video-related terms
    const videoTerms = allTerms.filter(t => t.includes('video'));
    this.logger.debug(
      `Video-related terms in dictionary: ${JSON.stringify(videoTerms.slice(0, 10))}`,
    );

    // Determine if we can use efficient prefix matching
    const canUsePrefixMatching = pattern.startsWith(basePattern) && basePattern.length > 0;

    this.logger.debug(
      `Pattern: ${pattern}, Base: ${basePattern}, Can use prefix: ${canUsePrefixMatching}`,
    );

    // Filter terms that match the wildcard pattern
    const candidateTerms: string[] = [];

    if (canUsePrefixMatching) {
      // Use efficient prefix matching approach (like regular term search)
      if (field && field !== '_all') {
        // For specific field, look for terms starting with 'field:basePattern'
        const fieldPrefix = `${field}:${basePattern}`;
        this.logger.debug(`Looking for terms starting with: ${fieldPrefix}`);

        for (const term of allTerms) {
          if (term.startsWith(fieldPrefix)) {
            const termValue = term.substring(field.length + 1);
            if (compiledPattern && compiledPattern.test(termValue)) {
              this.logger.debug(`Prefix field match: ${term} -> ${termValue} matches pattern`);
              candidateTerms.push(term);
            }
          }
        }
      } else {
        // For _all field, look for terms starting with '_all:basePattern'
        const allFieldPrefix = `_all:${basePattern}`;
        this.logger.debug(`Looking for _all field terms starting with: ${allFieldPrefix}`);

        for (const term of allTerms) {
          if (term.startsWith(allFieldPrefix)) {
            const termValue = term.substring(5); // Remove '_all:' prefix
            if (compiledPattern && compiledPattern.test(termValue)) {
              this.logger.debug(`Prefix _all match: ${term} -> ${termValue} matches pattern`);
              candidateTerms.push(term);
            }
          }

          // Also check other fields that might match the pattern
          const termParts = term.split(':');
          if (termParts.length >= 2 && termParts[0] !== '_all') {
            const termValue = termParts.slice(1).join(':');
            if (termValue.toLowerCase().startsWith(basePattern.toLowerCase())) {
              if (compiledPattern && compiledPattern.test(termValue)) {
                this.logger.debug(
                  `Prefix other field match: ${term} -> ${termValue} matches pattern`,
                );
                candidateTerms.push(term);
              }
            }
          }
        }
      }
    } else {
      // Use full pattern matching for complex wildcards (leading wildcards, multiple wildcards)
      for (const term of allTerms) {
        if (field && field !== '_all') {
          // For specific field, check if term starts with field:
          if (term.startsWith(`${field}:`)) {
            const termValue = term.substring(field.length + 1);
            if (compiledPattern && compiledPattern.test(termValue)) {
              this.logger.debug(`Field match: ${term} -> ${termValue} matches pattern`);
              candidateTerms.push(term);
            }
          }
        } else {
          // For all fields, check the term value part
          const termParts = term.split(':');
          if (termParts.length >= 2) {
            const termValue = termParts.slice(1).join(':');
            if (compiledPattern && compiledPattern.test(termValue)) {
              this.logger.debug(`All-field match: ${term} -> ${termValue} matches pattern`);
              candidateTerms.push(term);
            }
          }
        }
      }
    }

    this.logger.debug(
      `Found ${candidateTerms.length} candidate terms matching wildcard pattern: ${pattern}`,
    );

    // Process candidate terms using the reusable method
    const allScores: Array<{ id: string; score: number }> = [];
    for (const term of candidateTerms) {
      const termPostings = await this.getTermPostings(term, true);
      for (const { term: matchingTerm, postingList } of termPostings) {
        const scores = this.calculateScores(indexName, postingList, matchingTerm);
        allScores.push(...scores);
      }
    }

    // Merge scores for documents that match multiple terms
    return this.mergeWildcardScores(allScores);
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

    // Find common document IDs
    const docSets = results.map(result => new Set(result.map(item => item.id)));
    const commonDocIds = [...docSets[0]].filter(id => docSets.every(set => set.has(id)));

    // Create a map of document scores from all result sets
    const scoreMap = new Map<string, number>();
    results.forEach(result => {
      result.forEach(item => {
        scoreMap.set(item.id, (scoreMap.get(item.id) || 0) + item.score);
      });
    });

    // Return the intersected results with combined scores
    return commonDocIds.map(id => ({
      id,
      score: scoreMap.get(id) || 0,
    }));
  }

  private unionResults(
    results: Array<Array<{ id: string; score: number }>>,
  ): Array<{ id: string; score: number }> {
    if (results.length === 0) return [];
    if (results.length === 1) return results[0];

    // Combine all document IDs
    const scoreMap = new Map<string, number>();

    results.forEach(result => {
      result.forEach(item => {
        scoreMap.set(item.id, Math.max(scoreMap.get(item.id) || 0, item.score));
      });
    });

    // Convert map back to array
    return Array.from(scoreMap.entries()).map(([id, score]) => ({ id, score }));
  }

  private subtractResults(
    leftResults: Array<{ id: string; score: number }>,
    rightResults: Array<{ id: string; score: number }>,
  ): Array<{ id: string; score: number }> {
    const rightDocIds = new Set(rightResults.map(item => item.id));

    // Return documents in left that are not in right
    return leftResults.filter(item => !rightDocIds.has(item.id));
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
  ): Promise<SearchMatch[]> {
    if (!filter || !matches.length) {
      return matches;
    }

    // Get documents for filtering
    const documents = await this.fetchDocuments(
      matches[0].index,
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

    // Fetch documents in batch for efficiency
    const docs = await this.documentStorage.getDocuments(indexName, docIds);

    // Index by ID for easy lookup
    docs.documents.forEach(doc => {
      documents[doc.documentId] = doc.content;
    });

    return documents;
  }

  private getMatchingTerms(term: string): string[] {
    const allTerms = this.termDictionary.getTerms();
    return allTerms.filter(t => t.startsWith(term));
  }
}
