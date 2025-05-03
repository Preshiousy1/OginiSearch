import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { IndexSettings, IndexMappings } from '../../src/index/interfaces/index.interface';
import { RocksDBService } from '../../src/storage/rocksdb/rocksdb.service';
import { MockRocksDBService } from './test-database.module';
import { MongooseModule } from '@nestjs/mongoose';

export const createTestIndex = async (app: INestApplication, name = 'test-index'): Promise<any> => {
  const indexSettings: IndexSettings = {
    numberOfShards: 1,
    refreshInterval: '1s',
  };

  const indexMappings: IndexMappings = {
    properties: {
      title: {
        type: 'text',
        analyzer: 'standard',
      },
      content: {
        type: 'text',
        analyzer: 'standard',
      },
      tags: {
        type: 'keyword',
      },
    },
  };

  const response = await app.getHttpServer().post('/api/indices').send({
    name,
    settings: indexSettings,
    mappings: indexMappings,
  });

  return response.body;
};

export const overrideRocksDBProvider = (builder: any) =>
  builder.overrideProvider(RocksDBService).useClass(MockRocksDBService);

export const setupTestApp = async (modules: any[]): Promise<INestApplication> => {
  let builder = Test.createTestingModule({
    imports: [MongooseModule.forRoot(process.env.MONGODB_URI), ...modules],
  });
  builder = overrideRocksDBProvider(builder);

  const moduleFixture: TestingModule = await builder.compile();
  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  await app.init();
  return app;
};
