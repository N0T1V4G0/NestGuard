# NestGuard

[![CI](https://github.com/N0T1V4G0/NestGuard/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/N0T1V4G0/NestGuard/actions/workflows/ci.yml)

Sistema de controle de acesso para APIs: define quem pode ver e editar cada
registro, com permissões por papel e por dono. Projeto autoral — 154 testes
automatizados, CI e documentação OpenAPI.

Autorização RBAC granular para NestJS: catálogo de permissões type-safe
(permissão inexistente falha no build), ownership, condições declarativas por
recurso — e autorização que funciona em **listagens**, não só em recurso único.

Stack: Node 24 · NestJS 11 · TypeScript 6 · Prisma 7 · PostgreSQL 16 · Redis 7

---

## O problema que este projeto resolve

A maior parte das implementações de RBAC autoriza bem um recurso único e
tropeça na listagem. O padrão é buscar tudo e filtrar depois:

```ts
const posts = await prisma.post.findMany();
return posts.filter((p) => canRead(user, p)); // ⚠️
```

Isso parece funcionar e tem dois defeitos sérios:

1. **Quebra paginação.** `take: 20` traz 20 registros do banco; o filtro derruba
   12 e a página devolve 8. A próxima página pula registros.
2. **Vaza contagem.** Um `count()` conta o que o usuário não pode ver.

A alternativa é fazer a autorização descer para dentro da query. É o que o
[`scopeFor()`](src/core/rbac/permissions.service.ts) faz: traduz as condições
das permissões do usuário num fragmento `where` do Prisma.

```ts
@Get()
async findAll(@CurrentUser() user: User): Promise<Post[]> {
  const where = await this.permissions.scopeFor(user.id, 'post:read');

  if (where === null) {
    return []; // sem a permissão: lista vazia, não 403
  }

  return this.posts.findMany(where); // o filtro roda no banco
}
```

Duas decisões não óbvias aí:

- **`null` é diferente de `{}`.** `null` significa "nenhum acesso"; `{}` é
  "acesso irrestrito". Confundir os dois faria uma listagem sem permissão
  devolver a tabela inteira.
- **Sem permissão devolve lista vazia, não 403.** Um 403 numa listagem revela
  que existem registros invisíveis ali. A ausência de acesso não deveria ser
  distinguível da ausência de dados.

Papéis somam acesso e nunca subtraem, então duas condições viram um `OR`:

```ts
// papel A: post:read where ownerId = $user.id
// papel B: post:read where status = PUBLISHED
// scopeFor → { OR: [{ ownerId: 'user-1' }, { status: 'PUBLISHED' }] }
```

**Limite declarado da v1:** campo plano e um nível de relação
(`author.teamId`). Profundidade maior lança erro nomeando o caminho — num
sistema de autorização, um filtro silenciosamente errado é pior que uma falha
ruidosa.

## Permissão errada não compila

O catálogo vive em código, composto pelos blocos que cada módulo declara, e o
tipo `Permission` é derivado dele:

```ts
export type Permission = {
  [R in keyof Catalog]: `${R}:${Catalog[R][number]}`;
}[keyof Catalog];
```

```ts
@RequirePermission('post:creaet') // ❌ erro TS2345 no build
```

Papéis e concessões vivem no banco, onde precisam poder mudar sem deploy — mas
são validados contra o catálogo **no boot**: uma concessão apontando para
permissão inexistente impede a aplicação de subir, em vez de virar um `false`
silencioso em produção.

## Como a autorização é decidida

```
Requisição
   │
   ├─ JwtAuthGuard ......... autentica (ou @Public)
   │
   └─ PermissionGuard
        │
        ├─ resolve as permissões efetivas do usuário
        │    papéis diretos + herança (viewer ← editor ← admin)
        │    servido do cache Redis quando disponível
        │
        ├─ rota sem recurso ....... tem a permissão? → 200 / 403
        │
        └─ rota com recurso ....... carrega via ResourceRegistry,
             avalia ownership e condições → 200 / 403 / 404
```

Para listagens o caminho é outro: o handler chama `scopeFor()` e a decisão vira
parte da query.

O `ResourceRegistry` é o que mantém o core sem conhecer domínio: cada módulo se
registra, em vez de o núcleo importar os modelos.

```ts
// posts.module.ts
onModuleInit(): void {
  this.registry.register('post', (id) => this.posts.findById(id));
}
```

## Cache é opcional, e falha de cache não derruba autorização

O conjunto efetivo de permissões é cacheado em Redis com TTL. Duas garantias:

- `RBAC_CACHE_ENABLED=false` funciona sem Redis nenhum.
- Redis fora do ar loga um aviso e cai no banco. Autorização indisponível é
  pior que autorização lenta.

Como o cache torna permissão revogada válida até o TTL expirar, a escrita de
papéis passa pelo [`RolesService`](src/core/rbac/roles.service.ts), que invalida
junto com a mudança.

## Exemplo em funcionamento

O seed cria três papéis encadeados, que exercitam herança, ownership e condição
ao mesmo tempo:

| Papel    | Herda de | Concessões                                                        |
| -------- | -------- | ----------------------------------------------------------------- |
| `viewer` | —        | `post:read` onde `status = PUBLISHED`                             |
| `editor` | viewer   | `post:create`; `read`/`update`/`delete` onde `ownerId = $user.id` |
| `admin`  | editor   | `post:read/update/delete/publish` irrestritos                     |

Um `editor` listando posts recebe os próprios (rascunhos inclusive) **mais** os
publicados de todo mundo — a soma do papel dele com o que herda do `viewer`,
resolvida numa única query.

## Rodando

```bash
docker compose up -d          # postgres, redis, mailhog
cp .env.example .env
npm install
npx prisma migrate dev
npm run seed
npm start                     # http://localhost:3000
```

Documentação OpenAPI em `/docs`.

```bash
npm run test:all              # unitários + e2e
npm run lint
npx tsc --noEmit
```

Os e2e rodam contra Postgres e Redis de verdade, não contra mocks: autorização
é exatamente o tipo de código em que o mock esconde o bug que importa.

## Estrutura

```
src/
  core/
    auth/        JWT, refresh token rotativo, guards
    rbac/        catálogo, resolução, guards, scopeFor, cache
    config/      schema de ambiente validado com zod
    database/    PrismaService
  modules/
    auth/        registro, login, verificação, reset de senha
    posts/       módulo de exemplo — como um domínio pluga no RBAC
test/
  rbac/          as suítes que cobrem cada camada de autorização
```

## Decisões registradas

Escolhas que custaram mais pensamento que código:

- **Herança simples, não múltipla.** Herança múltipla vira grafo com detecção
  de ciclo — complexidade real para um caso raro. Mesmo com herança simples o
  `expandHierarchy` guarda os visitados: o schema não impede um ciclo, e sem
  isso o processo trava em laço infinito.
- **Papéis somam, nunca subtraem.** Sem `deny`. Uma concessão irrestrita
  absorve as condicionais da mesma permissão.
- **`tenantId` presente e sempre `null`.** Costura para multi-tenancy sem pagar
  a complexidade agora.
- **Catálogo em código, papéis no banco.** O que precisa de type-safety fica no
  build; o que precisa mudar sem deploy fica em runtime — com validação no boot
  ligando os dois.
