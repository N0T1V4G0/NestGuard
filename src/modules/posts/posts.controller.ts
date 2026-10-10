import { Body, Controller, Delete, Get, Param, Patch, Post as HttpPost } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Post, User } from '@prisma/client';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { CurrentResource } from '../../core/rbac/current-resource.decorator';
import { PermissionsService } from '../../core/rbac/permissions.service';
import { RequirePermission } from '../../core/rbac/require-permission.decorator';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';

@ApiTags('posts')
@ApiBearerAuth('bearer')
@Controller('posts')
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly permissions: PermissionsService,
  ) {}

  @ApiOperation({ summary: 'Cria um post' })
  @ApiResponse({ status: 201, description: 'Criado' })
  @ApiResponse({ status: 403, description: 'Falta a permissão post:create' })
  @HttpPost()
  @RequirePermission('post:create')
  create(@Body() dto: CreatePostDto, @CurrentUser() user: User): Promise<Post> {
    return this.posts.create({ ...dto, ownerId: user.id });
  }

  /**
   * Listagem escopada.
   *
   * Sem @RequirePermission de propósito: quem não tem a permissão recebe lista
   * vazia, não 403. Um 403 aqui revelaria que existem registros invisíveis.
   *
   * Precisa vir antes de `@Get(':id')`: declarada depois, a rota `/posts`
   * seria capturada pelo parâmetro.
   */
  @ApiOperation({
    summary: 'Lista posts visíveis ao usuário',
    description:
      'A listagem é escopada pelas permissões: quem não tem post:read recebe ' +
      'lista vazia, não 403 — um 403 revelaria a existência de registros invisíveis.',
  })
  @ApiResponse({ status: 200, description: 'Os posts que o usuário pode ver; pode vir vazia' })
  @Get()
  async findAll(@CurrentUser() user: User): Promise<Post[]> {
    const where = await this.permissions.scopeFor(user.id, 'post:read');

    if (where === null) {
      return [];
    }

    return this.posts.findMany(where);
  }

  @ApiOperation({ summary: 'Busca um post por id' })
  @ApiResponse({ status: 200, description: 'O post' })
  @ApiResponse({ status: 403, description: 'Falta a permissão post:read para este recurso' })
  @ApiResponse({ status: 404, description: 'Post inexistente' })
  @Get(':id')
  @RequirePermission('post:read', { resource: 'post', param: 'id' })
  findById(@CurrentResource() post: Post): Post {
    // O guard já carregou e autorizou: buscar de novo seria uma query a mais.
    return post;
  }

  @ApiOperation({ summary: 'Atualiza um post' })
  @ApiResponse({ status: 200, description: 'Atualizado' })
  @ApiResponse({ status: 403, description: 'Falta a permissão post:update para este recurso' })
  @ApiResponse({ status: 404, description: 'Post inexistente' })
  @Patch(':id')
  @RequirePermission('post:update', { resource: 'post', param: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdatePostDto): Promise<Post> {
    return this.posts.update(id, dto);
  }

  @ApiOperation({ summary: 'Remove um post' })
  @ApiResponse({ status: 200, description: 'Removido' })
  @ApiResponse({ status: 403, description: 'Falta a permissão post:delete para este recurso' })
  @ApiResponse({ status: 404, description: 'Post inexistente' })
  @Delete(':id')
  @RequirePermission('post:delete', { resource: 'post', param: 'id' })
  remove(@Param('id') id: string): Promise<Post> {
    return this.posts.delete(id);
  }
}
