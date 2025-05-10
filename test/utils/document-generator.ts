import { faker } from '@faker-js/faker';

export interface TestDocument {
  title: string;
  content: string;
  tags: string[];
  metadata?: Record<string, any>;
}

export class DocumentGenerator {
  /**
   * Generate a single test document with random data
   */
  static generateDocument(overrides: Partial<TestDocument> = {}): TestDocument {
    return {
      title: faker.lorem.sentence(),
      content: faker.lorem.paragraphs(3),
      tags: Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => faker.word.sample()),
      metadata: {
        createdAt: faker.date.past(),
        author: faker.person.fullName(),
        category: faker.helpers.arrayElement(['tech', 'business', 'science', 'health']),
      },
      ...overrides,
    };
  }

  /**
   * Generate multiple test documents
   */
  static generateDocuments(count: number, overrides: Partial<TestDocument> = {}): TestDocument[] {
    return Array.from({ length: count }, () => this.generateDocument(overrides));
  }

  /**
   * Generate a document with specific content for testing search functionality
   */
  static generateSearchableDocument(keywords: string[]): TestDocument {
    const content = keywords.join(' ') + ' ' + faker.lorem.paragraphs(2);
    return this.generateDocument({
      title: faker.helpers.arrayElement(keywords) + ' ' + faker.lorem.sentence(),
      content,
      tags: keywords,
    });
  }
}
