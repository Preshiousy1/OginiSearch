import { Injectable, Logger } from '@nestjs/common';
import { readFile, readdir } from 'fs/promises';
import { join, normalize } from 'path';
import { marked } from 'marked';

@Injectable()
export class DocumentationService {
  private readonly logger = new Logger(DocumentationService.name);
  private readonly docsPath: string;

  constructor() {
    // In Railway production, files are in /usr/src/app/dist/api/documentation/docs
    // In local production, files are in dist/api/documentation/docs
    // In development, files are in src/api/documentation/docs
    if (process.env.RAILWAY_ENVIRONMENT) {
      this.docsPath = join('/usr/src/app/dist/api/documentation/docs');
    } else {
      const baseDir = process.env.NODE_ENV === 'production' ? 'dist' : 'src';
      this.docsPath = join(process.cwd(), baseDir, 'api', 'documentation', 'docs');
    }
    this.logger.log(`Documentation path set to: ${this.docsPath}`);
  }

  async getDocumentationFile(path: string): Promise<string> {
    try {
      // Normalize the path to prevent directory traversal attacks
      const normalizedPath = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = join(this.docsPath, normalizedPath);

      // Verify the file is within the docs directory
      if (!filePath.startsWith(this.docsPath)) {
        this.logger.error(`Invalid file path: ${filePath} is not within ${this.docsPath}`);
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
      const files = await readdir(this.docsPath);
      const tutorialsPath = join(this.docsPath, 'tutorials');
      const tutorials = await readdir(tutorialsPath);

      const result = [
        ...files.filter(file => file.endsWith('.md')),
        ...tutorials.map(file => `tutorials/${file}`).filter(file => file.endsWith('.md')),
      ];
      return result;
    } catch (error) {
      this.logger.error(`Error listing files: ${error.message}`);
      throw new Error('Failed to list documentation files');
    }
  }

  async getTutorials(): Promise<string[]> {
    try {
      const tutorialsPath = join(this.docsPath, 'tutorials');
      const files = await readdir(tutorialsPath);
      const result = files.filter(file => file.endsWith('.md'));
      return result;
    } catch (error) {
      this.logger.error(`Error getting tutorials: ${error.message}`);
      throw new Error('Failed to list tutorial files');
    }
  }
}
