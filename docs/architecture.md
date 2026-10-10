# Arquitetura

Decisões estruturais do projeto e o raciocínio por trás delas. As decisões
específicas do modelo de permissão estão no [README](../README.md#decisões-registradas).

## Stack

| Área | Escolha |
|---|---|
| Runtime | Node 24 (Active LTS), mínimo `>=20.19` |
| Framework | NestJS 11 |
| ORM | Prisma 7.10.0 |
| Banco | PostgreSQL 16 |
| Cache | Redis 7 (opcional) |
| Hash de senha | Argon2 |
| Validação de ambiente | Zod, no boot |

## Estrutura

```
src/
  core/
    auth/        guards de autenticação, estratégias, decorators
    rbac/        catálogo de permissões, guards, scopeFor, condições
    database/    PrismaService
    common/      filtros, interceptors, health check
    config/      schema de ambiente
    crypto/      hash de senha e de token
    mail/        envio de e-mail
  modules/
    auth/        registro, login, refresh, reset, verificação
    users/
    posts/       módulo de domínio de exemplo
prisma/          schema, migrations, seed
test/            unitários e e2e
```

A separação `core/` e `modules/` tem uma regra que vale a pena nomear: **o core
não conhece os módulos de domínio**. O RBAC precisa carregar um recurso para
decidir ownership, mas não importa `PostsService`. Cada módulo se apresenta ao
`ResourceRegistry` no próprio `onModuleInit`:

```ts
onModuleInit(): void {
  this.registry.register('post', (id) => this.posts.findById(id));
}
```

O acoplamento aponta de domínio para core, nunca o contrário. Apagar um módulo
não deixa referência órfã no core — o mesmo vale para o catálogo de permissões,
onde cada módulo declara o próprio bloco em `<modulo>.permissions.ts`.

### Por que não arquitetura hexagonal

Hexagonal triplica arquivos por feature (porta, adaptador, caso de uso) e
contradiz a escolha de Prisma, que foi feita por velocidade de desenvolvimento.
O ganho — trocar o ORM sem tocar no domínio — paga-se em projetos longos com
múltiplos adaptadores, não numa API que usa Postgres e vai continuar usando.

### Por que não monorepo

Packages separados adicionam ferramental de build, resolução de workspace e
versionamento interno. Nada disso resolve um problema que este projeto tem.

## Autenticação

Access token curto no header `Authorization`, refresh token em cookie
httpOnly, ambos configuráveis para consumo mobile.

**Detecção de reuso por família.** Cada refresh token guarda a família a que
pertence. Se um token já rotacionado reaparece, a família inteira é invalidada
e o usuário é deslogado de todos os dispositivos — é o sinal de que um token
vazou e está sendo usado em paralelo.

Senhas com Argon2. Tokens de reset e verificação são guardados como hash, nunca
em texto puro: se o banco vazar, não são utilizáveis.

## Infraestrutura

### Node 24

Desenvolvimento e CI em Node 24, o Active LTS (EOL em abril de 2028). Node 26
foi descartado por ser a linha Current — imagens Docker e provedores demoram a
acompanhar, e exigir Current cria atrito na instalação.

A versão de desenvolvimento é separada da exigência mínima: `.nvmrc` com `24`,
mas `"engines": { "node": ">=20.19" }`, que é o piso real do NestJS 11. Quem
está preso ao Node 20 por infraestrutura não é barrado. O CI roda a matriz nas
duas versões.

### Prisma 7.10.0, fixado

No momento da escolha, o `latest` da CLI no npm era `8.0.0-rc.14` — um release
candidate, que `npm install` pega por padrão. RC não entra num projeto que
outras pessoas vão usar: a API ainda muda.

`npm audit` reporta vulnerabilidades altas vindas de dependências transitivas
da **CLI** (`deepmerge-ts` via `@prisma/config`, e `mysql2`). Verificado: o
`@prisma/client`, única peça que vai para produção, não depende de nenhuma
delas — e o `mysql2` sequer é carregado, já que o projeto usa Postgres.

A decisão foi manter a versão e documentar, em vez de silenciar com
`overrides`. Forçar versões que o Prisma não testou trocaria um problema
visível por um invisível.

### Imagem de produção

A imagem final tem 621MB, acima dos 200–400MB típicos de uma imagem Node. A
causa é o Prisma 7: o `@prisma/client` declara a CLI e o TypeScript como *peer
dependencies*, então o npm as instala e `npm prune --omit=dev` não as remove —
arrastando `studio-core`, engines de desenvolvimento e o compilador.

O Dockerfile remove esses diretórios explicitamente no estágio de build: de
1.1GB para 621MB, com `node_modules` caindo de 423MB para 299MB. O que resta é
o próprio client com seus engines, inerente à versão.

Em aberto: `prisma generate --no-engine` com Accelerate, ou bundler com
tree-shaking do client.

### Observabilidade e limites

Logging estruturado com Pino, request id correlacionado por requisição, e
redação de `authorization`, `cookie`, `password` e `token` — sem isso,
credencial vaza para o agregador de logs e fica retida por meses.

Health check com readiness e liveness separados. Rate limiting com dois
limites nomeados, ambos vindos do ambiente: `default` para tudo, `sensitive`
para rotas que aceitam credenciais ou disparam e-mail.

## Multi-tenancy

`tenantId` existe no schema desde a v1, sempre `null`. O `scopeFor` e o
`PrismaService` nascem com o gancho de tenant, desligado por padrão.

É costura, não implementação: adicionar multi-tenancy depois exige migration
de dados, não redesenho do modelo de permissão.
