import { Injectable, Logger } from '@nestjs/common';
import { readFile, readdir } from 'fs/promises';
import { join, normalize } from 'path';
import { marked } from 'marked';

@Injectable()
export class DocumentationService {
  private readonly logger = new Logger(DocumentationService.name);
  private readonly docsPath = join(process.cwd(), 'src', 'api', 'documentation', 'docs');

  async getDocumentationFile(path: string): Promise<string> {
    try {
      // Normalize the path to prevent directory traversal attacks
      const normalizedPath = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = join(this.docsPath, normalizedPath);

      // Verify the file is within the docs directory
      if (!filePath.startsWith(this.docsPath)) {
        throw new Error('Invalid file path');
      }

      const content = await readFile(filePath, 'utf-8');
      return marked(content);
    } catch (error) {
      this.logger.error(`Error reading file: ${error.message}`);
      throw new Error(`Documentation file not found: ${path}`);
    }
  }

  async listDocumentationFiles(): Promise<string[]> {
    try {
      this.logger.debug(`Listing files in: ${this.docsPath}`);
      const files = await readdir(this.docsPath);
      const tutorialsPath = join(this.docsPath, 'tutorials');
      this.logger.debug(`Listing files in: ${tutorialsPath}`);
      const tutorials = await readdir(tutorialsPath);

      const result = [
        ...files.filter(file => file.endsWith('.md')),
        ...tutorials.map(file => `tutorials/${file}`).filter(file => file.endsWith('.md')),
      ];
      this.logger.debug(`Found files: ${result.join(', ')}`);
      return result;
    } catch (error) {
      this.logger.error(`Error listing files: ${error.message}`);
      throw new Error('Failed to list documentation files');
    }
  }

  async getTutorials(): Promise<string[]> {
    try {
      const tutorialsPath = join(this.docsPath, 'tutorials');
      this.logger.debug(`Getting tutorials from: ${tutorialsPath}`);
      const files = await readdir(tutorialsPath);
      const result = files.filter(file => file.endsWith('.md'));
      this.logger.debug(`Found tutorials: ${result.join(', ')}`);
      return result;
    } catch (error) {
      this.logger.error(`Error getting tutorials: ${error.message}`);
      throw new Error('Failed to list tutorial files');
    }
  }
}
