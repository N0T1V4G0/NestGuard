import { Body, Controller, Get, Param, Post as HttpPost } from '@nestjs/common';
import { Post, User } from '@prisma/client';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @HttpPost()
  create(@Body() dto: { title: string; body: string }, @CurrentUser() user: User): Promise<Post> {
    return this.posts.create({ ...dto, ownerId: user.id });
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<Post | null> {
    return this.posts.findById(id);
  }
}
