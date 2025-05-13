import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  QueryExecutionPlan,
  QueryExecutionStep,
  TermQueryStep,
  BooleanQueryStep,
  PhraseQueryStep,
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
    }

    return [];
  }

  private async executeTermStep(
    indexName: string,
    step: TermQueryStep,
  ): Promise<Array<{ id: string; score: number }>> {
    const { term, field = '_all' } = step;
    this.logger.debug(`Executing term step for field:${field} term:${term}`);
    this.logger.debug(`All terms in dictionary: ${this.termDictionary.getTerms().join(', ')}`);

    const postingLists: PostingList[] = [];
    const bm25Scores: { id: string; score: number }[] = [];

    // Use the term directly as it already includes the field prefix
    this.logger.debug(`Looking for exact term match: ${term}`);
    const exactPostingList = await this.termDictionary.getPostingList(term);
    if (exactPostingList && exactPostingList.size() > 0) {
      this.logger.debug(`Found exact match for ${term} with ${exactPostingList.size()} documents`);
      const scores = this.calculateScores(indexName, exactPostingList, term);
      bm25Scores.push(...scores);
      postingLists.push(exactPostingList);
    } else {
      this.logger.debug(`No exact match found for ${term}`);
    }

    // Get prefix matches if no exact match found
    const matchingTerms = this.getMatchingTerms(term);
    this.logger.debug(`Found ${matchingTerms.length} prefix matches: ${matchingTerms.join(', ')}`);

    for (const t of matchingTerms) {
      if (t !== term) {
        // Skip exact term as we already processed it
        const postingList = await this.termDictionary.getPostingList(t);
        if (postingList && postingList.size() > 0) {
          this.logger.debug(`Found prefix match for ${t} with ${postingList.size()} documents`);
          const scores = this.calculateScores(indexName, postingList, t);
          bm25Scores.push(...scores);
          postingLists.push(postingList);
        }
      }
    }

    if (postingLists.length === 0) {
      this.logger.debug('No matching terms found in dictionary');
      return [];
    }

    return bm25Scores;
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
