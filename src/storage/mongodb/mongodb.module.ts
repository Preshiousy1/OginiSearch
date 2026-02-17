import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoDBService } from './mongodb.service';
import { IndexMetadata, IndexMetadataSchema } from './schemas/index.schema';
import { TermPostings, TermPostingsSchema } from './schemas/term-postings.schema';
import { PersistencePayload, PersistencePayloadSchema } from './schemas/persistence-payload.schema';
import {
  PersistencePendingJob,
  PersistencePendingJobSchema,
} from './schemas/persistence-pending-job.schema';
import {
  IndexingPendingJob,
  IndexingPendingJobSchema,
} from './schemas/indexing-pending-job.schema';
import { IndexRepository } from './repositories/index.repository';
import { TermPostingsRepository } from './repositories/term-postings.repository';
import { PersistencePayloadRepository } from './repositories/persistence-payload.repository';
import { PersistencePendingJobRepository } from './repositories/persistence-pending-job.repository';
import { IndexingPendingJobRepository } from './repositories/indexing-pending-job.repository';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: IndexMetadata.name, schema: IndexMetadataSchema },
      { name: TermPostings.name, schema: TermPostingsSchema },
      { name: PersistencePayload.name, schema: PersistencePayloadSchema },
      { name: PersistencePendingJob.name, schema: PersistencePendingJobSchema },
      { name: IndexingPendingJob.name, schema: IndexingPendingJobSchema },
    ]),
  ],
  providers: [
    MongoDBService,
    IndexRepository,
    TermPostingsRepository,
    PersistencePayloadRepository,
    PersistencePendingJobRepository,
    IndexingPendingJobRepository,
  ],
  exports: [
    MongoDBService,
    MongooseModule,
    IndexRepository,
    TermPostingsRepository,
    PersistencePayloadRepository,
    PersistencePendingJobRepository,
    IndexingPendingJobRepository,
  ],
})
export class MongoDBModule {}
