import { ProcessedDocument } from './index.interface';

export interface DocumentProcessor {
  processDocument(document: Record<string, any>): Promise<ProcessedDocument>;
}
