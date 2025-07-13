// Example usage of DocumentProcessor in indexing workflow

import { DocumentProcessorService } from '../document/document-processor.service';
import { IndexStatsService } from '../index/index-stats.service';
import { RawDocument } from '../document/interfaces/document-processor.interface';
import { TermDictionary } from '../index/interfaces/posting.interface';
import { SimplePostingList } from '../index/posting-list';

async function indexDocument(
  documentProcessor: DocumentProcessorService,
  indexStatsService: IndexStatsService,
  termDictionary: TermDictionary,
  document: RawDocument,
) {
  // 1. Process document with analyzers
  const processedDoc = documentProcessor.processDocument(document);

  // 2. Update index statistics
  indexStatsService.updateDocumentStats(processedDoc.id, processedDoc.fieldLengths);

  // 3. Index each field and its terms
  for (const [fieldName, field] of Object.entries(processedDoc.fields)) {
    for (const [term, frequency] of Object.entries(field.termFrequencies)) {
      // Add term to dictionary for this field
      const fieldTerm = `${fieldName}:${term}`;

      // Get or create posting list for this term
      const postings = await termDictionary.getPostings(fieldTerm);
      let postingList: SimplePostingList | undefined;
      if (postings) {
        postingList = new SimplePostingList();
        for (const [docId, positions] of postings.entries()) {
          postingList.addEntry({ docId, positions, frequency: positions.length });
        }
      }

      // Update term statistics
      indexStatsService.updateTermStats(fieldTerm, processedDoc.id);
    }
  }

  // 4. Store the document itself (example - in a real app this would use your document repository)
  // await documentRepository.save({
  //   id: processedDoc.id,
  //   source: processedDoc.source,
  //   // Store any other necessary metadata
  // });
}
