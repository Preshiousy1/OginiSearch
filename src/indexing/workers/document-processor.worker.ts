import { parentPort, workerData } from 'worker_threads';
import { AnalyzerRegistryService } from '../../analysis/analyzer-registry.service';

// Simple worker that only handles document processing
class DocumentProcessorWorker {
  private readonly analyzer: AnalyzerRegistryService;
  private isRunning = true;

  constructor() {
    this.analyzer = new AnalyzerRegistryService();
    this.initialize();
  }

  private initialize(): void {
    if (!parentPort) {
      throw new Error('This module must be run as a worker thread');
    }

    parentPort.on('message', async (message: any) => {
      if (message.type === 'process') {
        await this.processDocument(message.data);
      } else if (message.type === 'terminate') {
        this.terminate();
      }
    });

    // Report ready
    parentPort.postMessage({ type: 'ready' });
  }

  private async processDocument(data: {
    documentId: string;
    content: string;
    analyzer?: string;
  }): Promise<void> {
    try {
      if (!this.isRunning) return;

      const { documentId, content, analyzer = 'standard' } = data;

      // Get the analyzer instance
      const analyzerInstance = this.analyzer.getAnalyzer(analyzer);
      if (!analyzerInstance) {
        throw new Error(`Analyzer ${analyzer} not found`);
      }

      // Process the document
      const terms = analyzerInstance.analyze(content);

      // Create term dictionary entries
      const termDictionary = new Map<string, number[]>();
      terms.forEach((term, index) => {
        if (!termDictionary.has(term)) {
          termDictionary.set(term, []);
        }
        termDictionary.get(term).push(index);
      });

      // Send back results
      parentPort?.postMessage({
        type: 'result',
        data: {
          documentId,
          terms: Array.from(termDictionary.entries()).map(([term, positions]) => ({
            term,
            positions,
          })),
        },
      });
    } catch (error) {
      parentPort?.postMessage({
        type: 'error',
        data: {
          documentId: data.documentId,
          error: error.message,
        },
      });
    }
  }

  private terminate(): void {
    this.isRunning = false;
    process.exit(0);
  }
}

// Initialize worker
new DocumentProcessorWorker();
