import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoDBService } from './mongodb.service';
import { IndexMetadata, IndexMetadataSchema } from './schemas/index.schema';
import { TermPostings, TermPostingsSchema } from './schemas/term-postings.schema';
import { IndexRepository } from './repositories/index.repository';
import { TermPostingsRepository } from './repositories/term-postings.repository';

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
    ]),
  ],
  providers: [MongoDBService, IndexRepository, TermPostingsRepository],
  exports: [MongoDBService, MongooseModule, IndexRepository, TermPostingsRepository],
})
export class MongoDBModule {}
