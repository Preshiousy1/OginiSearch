import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MongoDBModule } from '../storage/mongodb/mongodb.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [MongoDBModule, StorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
