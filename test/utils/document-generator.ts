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
    //generate a random category from the list of categories
    const categories = ['tech', 'business', 'science', 'health'];
    const category = categories[faker.number.int({ min: 0, max: categories.length - 1 })];
    return {
      title: faker.lorem.sentence(),
      content: faker.lorem.paragraphs(3),
      tags: Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => faker.word.sample()),
      metadata: {
        createdAt: faker.date.past(),
        author: faker.person.fullName(),
        category,
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
    const titleHead = keywords[faker.number.int({ min: 0, max: keywords.length - 1 })];
    const titleTail = faker.lorem.sentence();
    const title = titleHead + ' ' + titleTail;
    return this.generateDocument({
      title,
      content,
      tags: keywords,
    });
  }
}
