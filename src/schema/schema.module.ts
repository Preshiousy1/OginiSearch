import { forwardRef, Module } from '@nestjs/common';
import { SchemaVersionManagerService } from './schema-version-manager.service';
import { SchemaController } from './schema.controller';
import { PostgreSQLModule } from '../storage/postgresql/postgresql.module';

@Module({
  imports: [forwardRef(() => PostgreSQLModule)],
  controllers: [SchemaController],
  providers: [SchemaVersionManagerService],
  exports: [SchemaVersionManagerService],
})
export class SchemaModule {}
