import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IndexMigrationService } from '../src/storage/index-storage/index-migration.service';

async function migrateIndices() {
  console.log('Starting index migration from RocksDB to MongoDB...');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const migrationService = app.get(IndexMigrationService);
    await migrationService.migrateIndicesToMongoDB();
    console.log('Index migration completed successfully');
  } catch (error) {
    console.error(`Index migration failed: ${error.message}`);
    process.exit(1);
  } finally {
    await app.close();
  }
}

migrateIndices();
