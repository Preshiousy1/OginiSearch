import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentStorageService } from './document-storage/document-storage.service';
import { PostgreSQLModule } from './postgresql/postgresql.module';
import { PostgreSQLIndexStorageService } from './postgresql/postgresql-index-storage.service';
import { SchemaModule } from '../schema/schema.module';

@Module({
  imports: [ConfigModule, PostgreSQLModule, SchemaModule],
  providers: [
    DocumentStorageService,
    {
      provide: 'IndexStorage',
      useClass: PostgreSQLIndexStorageService,
    },
  ],
  exports: [DocumentStorageService, 'IndexStorage', PostgreSQLModule],
})
export class StorageModule {}
