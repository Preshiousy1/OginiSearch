import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerDocModule } from './api/documentation/swagger-doc.module';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase body parser limit to 50mb
  app.use(json({ limit: '50mb' }));

  // Apply global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Set up Swagger documentation if not in production
  if (process.env.NODE_ENV !== 'production') {
    SwaggerDocModule.setup(app);
  }

  app.enableCors();

  await app.listen(3000);
}
bootstrap();
