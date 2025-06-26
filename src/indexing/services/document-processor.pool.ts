import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';

interface ProcessDocumentResult {
  documentId: string;
  terms: Array<{ term: string; positions: number[] }>;
}

@Injectable()
export class DocumentProcessorPool implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentProcessorPool.name);
  private workers: Worker[] = [];
  private workerStates: Map<number, boolean> = new Map(); // true = busy, false = available
  private taskQueue: Array<{
    documentId: string;
    content: string;
    analyzer?: string;
    resolve: (value: ProcessDocumentResult) => void;
    reject: (reason: any) => void;
  }> = [];
  private readonly maxWorkers: number;

  constructor(private readonly configService: ConfigService) {
    // Use 75% of available CPU cores for workers
    this.maxWorkers = Math.max(1, Math.floor(os.cpus().length * 0.75));
  }

  async onModuleInit() {
    await this.startWorkers();
  }

  async onModuleDestroy() {
    await this.stopWorkers();
  }

  private async startWorkers(): Promise<void> {
    this.logger.log(`Starting ${this.maxWorkers} document processing workers...`);

    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(path.join(__dirname, '../workers/document-processor.worker.js'));
      const workerId = this.workers.length;

      worker.on('message', message => {
        if (message.type === 'ready') {
          this.logger.debug(`Worker ${workerId} is ready`);
          this.workerStates.set(workerId, false);
        } else if (message.type === 'result') {
          this.handleWorkerResult(workerId, message.data);
        } else if (message.type === 'error') {
          this.handleWorkerError(workerId, message.data);
        }
      });

      worker.on('error', error => {
        this.logger.error(`Worker ${workerId} error: ${error.message}`);
        this.handleWorkerError(workerId, { error: error.message });
      });

      worker.on('exit', code => {
        if (code !== 0) {
          this.logger.warn(`Worker ${workerId} exited with code ${code}`);
          this.restartWorker(workerId);
        }
      });

      this.workers.push(worker);
    }

    this.logger.log(`Started ${this.workers.length} document processing workers`);
  }

  private async stopWorkers(): Promise<void> {
    this.logger.log('Stopping all workers...');

    const terminatePromises = this.workers.map(worker => {
      return new Promise<void>(resolve => {
        worker.postMessage({ type: 'terminate' });
        worker.on('exit', () => resolve());
      });
    });

    await Promise.all(terminatePromises);
    this.workers = [];
    this.workerStates.clear();
    this.taskQueue = [];

    this.logger.log('All workers stopped');
  }

  private async restartWorker(workerId: number): Promise<void> {
    if (this.workers[workerId]) {
      try {
        await this.workers[workerId].terminate();
      } catch (error) {
        this.logger.error(`Error terminating worker ${workerId}: ${error.message}`);
      }
    }

    const worker = new Worker(path.join(__dirname, '../workers/document-processor.worker.js'));

    worker.on('message', message => {
      if (message.type === 'ready') {
        this.logger.debug(`Worker ${workerId} is ready`);
        this.workerStates.set(workerId, false);
        this.processNextTask();
      } else if (message.type === 'result') {
        this.handleWorkerResult(workerId, message.data);
      } else if (message.type === 'error') {
        this.handleWorkerError(workerId, message.data);
      }
    });

    worker.on('error', error => {
      this.logger.error(`Worker ${workerId} error: ${error.message}`);
      this.handleWorkerError(workerId, { error: error.message });
    });

    worker.on('exit', code => {
      if (code !== 0) {
        this.logger.warn(`Worker ${workerId} exited with code ${code}`);
        this.restartWorker(workerId);
      }
    });

    this.workers[workerId] = worker;
  }

  private handleWorkerResult(workerId: number, result: ProcessDocumentResult): void {
    this.workerStates.set(workerId, false);
    const task = this.taskQueue.shift();

    if (task) {
      task.resolve(result);
      this.processNextTask();
    }
  }

  private handleWorkerError(workerId: number, error: any): void {
    this.workerStates.set(workerId, false);
    const task = this.taskQueue.shift();

    if (task) {
      task.reject(error);
      this.processNextTask();
    }
  }

  private getAvailableWorker(): number | null {
    for (const [id, isBusy] of this.workerStates.entries()) {
      if (!isBusy) return id;
    }
    return null;
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0) return;

    const availableWorkerId = this.getAvailableWorker();
    if (availableWorkerId === null) return;

    const nextTask = this.taskQueue[0];
    if (!nextTask) return;

    this.workerStates.set(availableWorkerId, true);
    this.workers[availableWorkerId].postMessage({
      type: 'process',
      data: {
        documentId: nextTask.documentId,
        content: nextTask.content,
        analyzer: nextTask.analyzer,
      },
    });
  }

  public async processDocument(
    documentId: string,
    content: string,
    analyzer?: string,
  ): Promise<ProcessDocumentResult> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ documentId, content, analyzer, resolve, reject });
      this.processNextTask();
    });
  }
}
