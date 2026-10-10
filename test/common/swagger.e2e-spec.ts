import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupSwagger } from '../../src/core/common/swagger';
import { createTestApp } from '../helpers/app';

describe('Documentação OpenAPI', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // O setup precisa acontecer antes do init: SwaggerModule.setup() registra
    // as rotas /docs e /docs-json, e registrá-las depois não tem efeito.
    app = await createTestApp({}, setupSwagger);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serve o documento JSON sem autenticação', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
  });

  it('documenta as rotas de auth e de posts', async () => {
    const { body } = await request(app.getHttpServer()).get('/docs-json');

    expect(body.paths['/auth/login']).toBeDefined();
    expect(body.paths['/auth/register']).toBeDefined();
    expect(body.paths['/posts']).toBeDefined();
    expect(body.paths['/posts/{id}']).toBeDefined();
  });

  it('declara o esquema de bearer auth', async () => {
    const { body } = await request(app.getHttpServer()).get('/docs-json');
    expect(body.components.securitySchemes.bearer).toBeDefined();
  });

  it('descreve o corpo do registro com os campos reais', async () => {
    const { body } = await request(app.getHttpServer()).get('/docs-json');
    const schema = body.components.schemas.RegisterDto;

    expect(Object.keys(schema.properties).sort()).toEqual(['email', 'name', 'password']);
    expect(schema.required.sort()).toEqual(['email', 'password']);
  });

  it('marca as rotas protegidas como exigindo bearer', async () => {
    const { body } = await request(app.getHttpServer()).get('/docs-json');
    expect(body.paths['/posts'].post.security).toContainEqual({ bearer: [] });
  });

  it('não marca as rotas públicas como exigindo bearer', async () => {
    const { body } = await request(app.getHttpServer()).get('/docs-json');
    expect(body.paths['/auth/login'].post.security).toBeUndefined();
  });

  it('documenta o 403 nas rotas com permissão', async () => {
    const { body } = await request(app.getHttpServer()).get('/docs-json');
    expect(body.paths['/posts'].post.responses['403']).toBeDefined();
  });
});
