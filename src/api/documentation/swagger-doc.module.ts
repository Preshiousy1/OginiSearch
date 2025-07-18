import { Module } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';
import { ApiModule } from '../api.module';

/**
 * Swagger documentation module
 * Centralizes Swagger configuration for better organization
 */
@Module({})
export class SwaggerDocModule {
  /**
   * Sets up Swagger documentation for the application
   * @param app The NestJS application instance
   */
  static setup(app: INestApplication): void {
    const options = new DocumentBuilder()
      .setTitle('Ogini API')
      .setDescription(
        'RESTful API for the Ogini engine - a high-performance full-text search service optimized for speed and relevance.',
      )
      .setVersion('1.0')
      .addTag('indices', 'Index management operations')
      .addTag('documents', 'Document management operations')
      .addTag('search', 'Search and suggest operations')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .setContact('Ogini Team', 'https://ogini.io', 'support@ogini.io')
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      .setExternalDoc('Additional Documentation', 'https://docs.ogini.io')
      .build();

    const document = SwaggerModule.createDocument(app, options, {
      include: [ApiModule],
      deepScanRoutes: true,
    });

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        deepLinking: true,
      },
      customSiteTitle: 'Ogini API Documentation',
      customCss: '.swagger-ui .topbar { display: none }',
      customfavIcon: 'https://ogini.io/favicon.ico',
    });
  }
}
