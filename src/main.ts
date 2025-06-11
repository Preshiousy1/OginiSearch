import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Configure body parser with larger limits
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(express.json({ limit: '50mb' }));
  expressApp.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Enable CORS
  app.enableCors({
    origin: configService.get('CORS_ORIGIN', '*'),
  });

  // Enable validation
  app.useGlobalPipes(new ValidationPipe());

  // Swagger setup
  if (configService.get('ENABLE_SWAGGER', true)) {
    const config = new DocumentBuilder()
      .setTitle('Ogini API')
      .setDescription('The Ogini Search Engine API documentation')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(configService.get('DOCS_PATH', 'api'), app, document);
  }

  // Get port from environment or use default
  const port = configService.get('PORT', 3000);
  const host = configService.get('HOST', '0.0.0.0');

  await app.listen(port, host);
  console.log(`Application is running on: ${await app.getUrl()}`);
  console.log('Body parser configured with 50MB limit for large payloads');
}
bootstrap();
