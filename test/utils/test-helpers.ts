import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { IndexSettings, IndexMappings } from '../../src/index/interfaces/index.interface';
import * as express from 'express';

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

export const setupTestApp = async (modules: any[]): Promise<INestApplication> => {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [...modules],
  }).compile();

  const app = moduleFixture.createNestApplication();

  // Configure Express middleware before initialization
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(express.json({ limit: '500mb' }));
  expressApp.use(express.urlencoded({ limit: '500mb', extended: true }));

  app.useGlobalPipes(new ValidationPipe());
  await app.init();
  return app;
};
