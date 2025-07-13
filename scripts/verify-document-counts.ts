import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DocumentCountVerifierService } from '../src/index/document-count-verifier.service';
import { Logger } from '@nestjs/common';

async function verifyDocumentCounts() {
  const logger = new Logger('DocumentCountVerifier');
  const indexName = process.argv[2];

  if (!indexName) {
    logger.error('Please provide an index name as an argument');
    process.exit(1);
  }

  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const verifier = app.get(DocumentCountVerifierService);

    logger.log(`Verifying document count for index: ${indexName}`);
    await verifier.verifyIndexDocumentCount(indexName);
    
    await app.close();
  } catch (error) {
    logger.error(`Error verifying document count: ${error.message}`);
    process.exit(1);
  }
}

verifyDocumentCounts(); 