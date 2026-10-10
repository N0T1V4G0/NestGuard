import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Publica a documentação OpenAPI em /docs e o JSON em /docs-json.
 *
 * É a primeira coisa que o comprador abre depois de subir o projeto, e o que
 * economiza o trabalho de descrever a API à mão.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('API')
    .setDescription('Autenticação e autorização com RBAC granular')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      // O nome 'bearer' é o que @ApiBearerAuth() referencia nos controllers.
      'bearer',
    )
    // O refresh token nunca vai no corpo nem no header: ele vive no cookie
    // httpOnly, e /auth/refresh e /auth/logout dependem dele.
    .addCookieAuth('refresh_token', { type: 'apiKey', in: 'cookie' }, 'refresh_token')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
}
