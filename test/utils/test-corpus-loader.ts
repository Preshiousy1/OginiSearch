import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TestDocument } from './document-generator';
import { DocumentGenerator } from './document-generator';

export interface TestCorpus {
  name: string;
  documents: TestDocument[];
  description?: string;
  metadata?: Record<string, any>;
}

export class TestCorpusLoader {
  private static readonly CORPUS_DIR = join(__dirname, '../data/corpus');

  /**
   * Load a test corpus from a JSON file
   */
  static loadCorpus(name: string): TestCorpus {
    try {
      const filePath = join(this.CORPUS_DIR, `${name}.json`);
      const data = readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as TestCorpus;
    } catch (error) {
      throw new Error(`Failed to load test corpus '${name}': ${error.message}`);
    }
  }

  /**
   * Save a test corpus to a JSON file
   */
  static saveCorpus(corpus: TestCorpus): void {
    try {
      const filePath = join(this.CORPUS_DIR, `${corpus.name}.json`);
      const data = JSON.stringify(corpus, null, 2);
      writeFileSync(filePath, data, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save test corpus '${corpus.name}': ${error.message}`);
    }
  }

  /**
   * List all available test corpora
   */
  static listCorpora(): string[] {
    try {
      const files = readdirSync(this.CORPUS_DIR);
      return files.filter(file => file.endsWith('.json')).map(file => file.replace('.json', ''));
    } catch (error) {
      throw new Error(`Failed to list test corpora: ${error.message}`);
    }
  }

  /**
   * Create a new test corpus with generated documents
   */
  static createCorpus(
    name: string,
    documentCount: number,
    options: {
      description?: string;
      metadata?: Record<string, any>;
      documentGenerator?: () => TestDocument;
    } = {},
  ): TestCorpus {
    const documents = Array.from({ length: documentCount }, () =>
      options.documentGenerator
        ? options.documentGenerator()
        : DocumentGenerator.generateDocument(),
    );

    const corpus: TestCorpus = {
      name,
      documents,
      description: options.description,
      metadata: options.metadata,
    };

    this.saveCorpus(corpus);
    return corpus;
  }
}
