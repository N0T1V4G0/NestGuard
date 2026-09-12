# Boilerplate NestJS com RBAC granular — design da v1

Data: 2026-09-12
Status: aprovado, pronto para plano de implementação

## Contexto

Produto comercial: um boilerplate NestJS vendido como licença única (US$ 129
por projeto, US$ 349 ilimitada). O comprador típico é fundador solo ou
freelancer que quer subir um SaaS sem gastar duas semanas montando a base.

A diferenciação é RBAC. Quase todo boilerplate do mercado entrega um
`@Roles('admin')` decorativo. Este entrega permissão granular por recurso,
checagem de ownership, herança de papéis, e — o ponto que nenhum concorrente
cobre — autorização que funciona em listagens, não só em recurso único.

O gargalo do negócio é distribuição, não implementação. O escopo abaixo é
deliberadamente pequeno para que a primeira venda aconteça cedo.

## Decisões

| Área | Decisão |
|---|---|
| Runtime | Node 24 (Active LTS) para dev e CI. `engines: >=20.19` |
| Framework | NestJS 11 |
| ORM | Prisma |
| Banco | PostgreSQL |
| Cache e filas | Redis, BullMQ |
| Hash de senha | Argon2 |
| Estrutura | Modular por feature, com `core` compartilhado |
| Modelo de permissão | Papéis + permissões atômicas + ownership + condições declarativas |
| Catálogo de permissões | Em código, type-safe. Papéis no banco |
| Autorização em listagem | Helper `scopeFor()` que devolve fragmento `where` do Prisma |
| Autenticação | JWT de acesso curto + refresh rotativo com detecção de reuso |
| Entrega | Repo template + gerador de módulo |
| Multi-tenancy | Fora da v1. Costuras preparadas no schema e no `scopeFor` |

## Estrutura do projeto

```
src/
  core/
    auth/           guards de autenticação, estratégias, decorators
    rbac/           catálogo de permissões, guard, scopeFor, condições
    database/       PrismaService, extensões, gancho de tenant
    common/         filtros, interceptors, pipes, DTOs base
  modules/
    users/
    auth/
    billing/
  jobs/             BullMQ: processors e filas
prisma/             schema, migrations, seeds
test/               e2e de auth, RBAC e billing
tools/              gerador de módulo
docs/               site de documentação
```

Arquitetura hexagonal foi descartada: triplica arquivos por feature e
contradiz a escolha de Prisma, que foi feita por velocidade. O comprador
precisa reconhecer o código na primeira leitura. Monorepo com packages também
foi descartado — adiciona ferramental de build que ninguém pediu.

## RBAC

### Catálogo de permissões

As permissões vivem em código e o tipo é derivado delas:

```ts
export const PERMISSIONS = {
  post: ['create', 'read', 'update', 'delete', 'publish'],
  invoice: ['read', 'refund'],
} as const;

export type Permission = PermissionOf<typeof PERMISSIONS>;
// 'post:create' | 'post:read' | ... | 'invoice:refund'
```

`@RequirePermission('post:updaet')` falha no build. Isso é barato de
implementar e é material de landing page.

### Schema

```prisma
model Role {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  isSystem    Boolean  @default(false)
  inheritsId  String?
  inherits    Role?    @relation("RoleHierarchy", fields: [inheritsId], references: [id])
  grants      RoleGrant[]
  users       UserRole[]
  tenantId    String?   // costura de multi-tenancy, sempre null na v1
}

model RoleGrant {
  id         String  @id @default(cuid())
  roleId     String
  permission String  // "post:update", validado contra o catálogo no boot
  condition  Json?   // { "ownerId": "$user.id" } ou { "status": "draft" }
  role       Role    @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@unique([roleId, permission])
}

model UserRole {
  userId String
  roleId String
  @@id([userId, roleId])
}
```

Três pontos:

**`permission` é String no banco.** Prisma não referencia tipos TypeScript. A
proteção é uma validação no boot: a aplicação varre os `RoleGrant` e falha ao
subir se encontrar permissão fora do catálogo. Isso pega typo e pega o caso
perigoso — permissão renomeada em código sem migração das linhas.

**A condição é JSON declarativo, não código.** Essa é a decisão que faz o
`scopeFor` existir: condição declarativa traduz para `where` do Prisma e roda
dentro da query. Se fosse função TypeScript, só poderia rodar depois do
carregamento, e listagem voltaria a ser insegura.

**Hierarquia é auto-relação simples.** Um papel herda de no máximo um outro.
Herança múltipla vira grafo com detecção de ciclo — complexidade real para um
caso raro. Um usuário pode ter vários papéis, o que cobre a maioria das
combinações.

Fora do escopo deliberadamente: permissões atribuídas direto ao usuário, sem
papel. Parecem convenientes e viram bagunça não-auditável.

### Resolução

O `AuthGuard` valida o JWT e popula o usuário no request. O `PermissionGuard`
lê o metadata do decorator, monta o conjunto efetivo de permissões — papéis,
herança, condições anexadas — e decide. O conjunto é montado uma vez por
request e cacheado em Redis com TTL curto, invalidado quando um papel muda.

### Os três casos

**Permissão simples de rota.** Nada a carregar:

```ts
@Post()
@RequirePermission('post:create')
create(@Body() dto: CreatePostDto) { ... }
```

**Recurso único, com ownership e condição.** O guard carrega o recurso, avalia
a condição, nega com 403 antes do controller. O recurso carregado é injetado —
o service não busca de novo. Cada resource é registrado uma vez, dizendo ao
guard como carregá-lo:

```ts
@Patch(':id')
@RequirePermission('post:update', { resource: 'post', param: 'id' })
update(@Param('id') id: string, @CurrentResource() post: Post) { ... }
```

**Listagem.** Não há recurso para carregar, e filtrar depois da query quebra
paginação e vaza dados:

```ts
@Get()
@RequirePermission('post:read')
async findAll(@CurrentUser() user: User) {
  const where = await this.permissions.scopeFor(user, 'post:read');
  return this.prisma.post.findMany({ where });
}
```

`scopeFor` traduz as condições em `where`:

- permissão sem condição → `{}`
- `{ ownerId: '$user.id' }` → `{ ownerId: user.id }`
- mesma permissão por dois papéis com condições diferentes → `{ OR: [...] }`,
  porque papéis somam acesso e nunca subtraem
- sem a permissão → o guard já negou antes

**Limite da v1:** condições de campo plano e um nível de relação
(`{ 'author.teamId': '$user.teamId' }`). Além disso, erro explícito e legível
no boot, nunca falha silenciosa. Relação mais profunda é roadmap.

### Negação silenciosa em listagem

Um usuário sem acesso a nada recebe lista vazia, não 403. É intencional: 403
numa listagem vaza a existência de registros que ele não pode ver. É
contraintuitivo e vai gerar issue de comprador achando que é bug — a
documentação precisa de um box destacado sobre isso.

### Testes como argumento de venda

A suíte cobre a matriz completa: permissão ausente; presente sem condição;
presente com ownership satisfeito; com ownership violado; herdada de papel
pai; somada de dois papéis com condições diferentes; listagem escopada. Essa
matriz vira tabela na documentação — nenhum concorrente gratuito tem isso.

## Auth

Registro, login, refresh rotativo com detecção de reuso, reset de senha,
verificação de e-mail.

Access token por header `Authorization`, refresh por cookie httpOnly, ambos
configuráveis para consumo mobile. Detecção de reuso por família: cada refresh
token guarda sua família, e se um token já rotacionado reaparece, a família
inteira é invalidada e o usuário é deslogado de todos os dispositivos.

Senhas com Argon2. Tokens de reset e verificação são hash no banco, nunca
texto puro — se o banco vazar, não são utilizáveis.

## Billing

Stripe com assinatura, trial, mudança de plano e cancelamento.

O webhook é a parte que importa: assinatura verificada, processamento
idempotente por `event.id` gravado em tabela, e entrega via fila — o endpoint
valida, enfileira e responde 200 rápido. Stripe reenvia eventos e entrega fora
de ordem; webhook ingênuo gera cobrança duplicada. Falha de pagamento tem
período de graça antes do downgrade.

O plano conecta ao RBAC: cada plano mapeia para papéis, então subir de plano
concede permissões. Amarra as duas features e é boa demo.

## Filas

BullMQ sobre Redis. Jobs reais já implementados: envio de e-mail,
processamento de webhook de billing, limpeza de tokens expirados. Retry com
backoff exponencial e dead letter queue. Um job de exemplo documentado serve
de molde.

## Infraestrutura

### Versão do Node

Desenvolvimento e CI em **Node 24**, o Active LTS (EOL abril de 2028). Node 26
foi descartado por ser a linha Current até outubro de 2026 — exigir Current de
quem comprou cria atrito na instalação, e imagens Docker e provedores demoram
a acompanhar. Node 20 foi descartado por estar em manutenção e por sinalizar
produto desatualizado no `package.json`.

Separar a versão de desenvolvimento da exigência mínima: `.nvmrc` com `24`,
mas `"engines": { "node": ">=20.19" }` no `package.json` — o piso real do
NestJS 11. Assim o comprador preso ao 20 por infraestrutura não é barrado. O
CI roda a matriz nas duas versões, o que vira uma linha honesta na
documentação.

Nota de manutenção: a partir de outubro de 2026 o Node passa a uma major por
ano, com número alinhado ao ano-calendário e toda release virando LTS.

### Versão do Prisma e o audit da CLI

Prisma fixado em **7.10.0** (CLI e client). No momento da escolha, o `latest`
da CLI no npm era `8.0.0-rc.14` — um release candidate, que o `npm install`
pega por padrão. RC não entra em produto vendido: a API ainda muda, e o
comprador ficaria numa versão sem suporte estável.

`npm audit` reporta 4 vulnerabilidades altas vindas de dependências
transitivas da **CLI** (`deepmerge-ts` via `@prisma/config`, e `mysql2`).
Verificado: o `@prisma/client`, única peça que vai para produção, não depende
de nenhuma delas — e o `mysql2` sequer é carregado, já que o projeto usa
Postgres. Não existe versão do Prisma 7 sem esse ruído; as saídas seriam
voltar ao 6.19.3 (uma major atrás, em produto novo) ou ir ao 8 RC.

Decisão: manter 7.10.0 e **documentar**, em vez de silenciar com `overrides`.
Forçar versões que o Prisma não testou trocaria um problema visível por um
invisível.

**Pendência de documentação:** a página de instalação precisa de uma nota
explicando que o audit aparece na primeira instalação, que é restrito ao
ferramental de desenvolvimento, e que sai quando o Prisma atualizar. O
comprador vai rodar `npm ci` e ver isso — melhor encontrar a explicação do que
abrir issue.

### Demais

Docker Compose para dev (app, Postgres, Redis, Mailhog). Dockerfile
multi-stage para produção. GitHub Actions com lint, testes e build. Migrations
e seeds do Prisma, com o seed criando papéis de sistema e um usuário admin.
Health check com readiness e liveness separados. Logging estruturado com Pino,
com request id correlacionado. Rate limiting nas rotas de auth. Variáveis de
ambiente validadas no boot com Zod.

## Gerador de módulo

Um comando que cria um módulo novo já com controller, service, permissões
registradas no catálogo, testes e migration.

Ele existe para proteger o diferencial, não por conveniência. Sem ele, o
comprador escreve o primeiro módulo à mão, esquece o `scopeFor` na listagem, e
o RBAC vendido vira decoração no projeto dele. Cada uso reforça as convenções
do boilerplate em vez de deixar o projeto divergir.

Um CLI de scaffolding (`npx create-...`) foi descartado: é usado uma única
vez, substitui algo que já é fácil (clonar e apagar pastas), e é um subprojeto
inteiro. O gerador de módulo é usado toda semana.

## Multi-tenancy: costuras, não implementação

`tenantId` existe no schema desde a v1, sempre null. O `scopeFor` e o
`PrismaService` nascem com o gancho de tenant, desligado por padrão.

A razão: multi-tenancy completo atrasa a primeira venda sem ser o que atrai o
comprador — RBAC é. Mas descobrir na v2 que ele exige refatorar todo o data
access é o pior dos mundos.

## Fora da v1

Admin panel, frontend, WebSocket, i18n, upload de arquivo, multi-tenancy
implementado, condições de RBAC com relação aninhada profunda. Todos viram
roadmap e justificam a v2 paga.

## Documentação

São duas coisas distintas, e ambas fazem parte do produto.

### Swagger / OpenAPI — documentação da API

`@nestjs/swagger` com Swagger UI, DTOs e controllers decorados, bearer auth
configurado e exemplos reais de request e response. É o que o comprador vê ao
subir o projeto pela primeira vez, e economiza justamente o trabalho chato que
ele está pagando para não fazer. Também rende screenshot de landing page: a
lista de endpoints de auth e RBAC comunica valor mais rápido que texto.

**Quando:** última task do plano 2 (RBAC), decidido em 2026-09-12. Não antes,
porque os decorators do Swagger convivem nos mesmos arquivos que os decorators
de RBAC — fazer agora significaria mexer duas vezes nos mesmos DTOs e
controllers. Não depois, porque o gerador de módulo (plano 3) precisa emitir
código já decorado.

### Site — documentação de uso do boilerplate

Site em Docusaurus, escrito junto com o código, não no final. Guia de
instalação, uma página por decisão arquitetural, o tutorial "adicionando seu
primeiro módulo" usando o gerador, e a matriz de casos de RBAC como tabela.

Documentação é o que separa um repo de US$ 30 de um produto de US$ 150, e é o
que reduz suporte — o custo escondido desse modelo.

## Ordem de execução

1. Auth e RBAC — o coração, e o que aparece na demo
2. Gerador de módulo
3. Billing: dá mais vontade de procrastinar e impressiona menos em screenshot,
   mas é o que justifica o preço
4. Landing page e lista de espera

Decisão de 2026-09-12: o produto vem antes da landing. A conversa original
colocava a landing primeiro porque o gargalo do negócio é distribuição, não
implementação — a discordância fica registrada aqui. O contra-argumento aceito
é que uma landing de RBAC sem demo real é genérica, e o diferencial deste
produto só é demonstrável com código funcionando.

**Marco de validação:** quando auth e RBAC estiverem funcionando, publicar o
diferencial — um post técnico sobre autorização em listagem no NestJS, com o
código real. Não exige landing nem nome definitivo, e é o primeiro teste de
que existe interesse. Sem prazo fixo, este marco é o único freio contra
escopo infinito.

## Em aberto

- **Nome do produto.** Seis candidatos testados e descartados por colisão
  (Gatekit, Granta, Nestward, Grantly, Rolecraft, Kestrel, Vellum, Wardly,
  Guardly, Vantru). A raiz `grant*` está saturada no npm e colide com OAuth.
  Conclusão: decidir depois, com ferramenta de disponibilidade real
  (Namecheap, instant.domains, `npm search`), não por busca web. O critério
  útil é "ninguém no meu nicho usa", não "ninguém no mundo usa" — colisão
  fora do mercado de dev tooling é aceitável. Não bloqueia implementação;
  só é exigido quando a landing entrar na fila.
- Estratégia de entrega do repositório privado (só importa na primeira venda)

## Riscos

Manutenção é vitalícia: toda major do NestJS ou do Stripe gera trabalho, e
comprador de licença única espera atualização. Concorrência gratuita existe e
é forte. O mercado é finito — isto é renda complementar, não substituição de
salário.

O risco de execução maior é o prazo elástico. Sem data, "mais uma feature" não
tem freio, e o modo de falha conhecido é passar meses polindo um produto que
ninguém pediu.
