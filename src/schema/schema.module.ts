import { Module, forwardRef } from '@nestjs/common';
import { SchemaVersionManagerService } from './schema-version-manager.service';
import { SchemaController } from './schema.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [forwardRef(() => StorageModule)],
  controllers: [SchemaController],
  providers: [SchemaVersionManagerService],
  exports: [SchemaVersionManagerService],
})
export class SchemaModule {}
