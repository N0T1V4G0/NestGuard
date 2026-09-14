import { Body, Controller, Delete, Get, Param, Patch, Post as HttpPost } from '@nestjs/common';
import { Post, User } from '@prisma/client';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { CurrentResource } from '../../core/rbac/current-resource.decorator';
import { RequirePermission } from '../../core/rbac/require-permission.decorator';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @HttpPost()
  @RequirePermission('post:create')
  create(@Body() dto: { title: string; body: string }, @CurrentUser() user: User): Promise<Post> {
    return this.posts.create({ ...dto, ownerId: user.id });
  }

  @Get(':id')
  @RequirePermission('post:read', { resource: 'post', param: 'id' })
  findById(@CurrentResource() post: Post): Post {
    // O guard já carregou e autorizou: buscar de novo seria uma query a mais.
    return post;
  }

  @Patch(':id')
  @RequirePermission('post:update', { resource: 'post', param: 'id' })
  update(@Param('id') id: string, @Body() dto: { title?: string; body?: string }): Promise<Post> {
    return this.posts.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('post:delete', { resource: 'post', param: 'id' })
  remove(@Param('id') id: string): Promise<Post> {
    return this.posts.delete(id);
  }
}
