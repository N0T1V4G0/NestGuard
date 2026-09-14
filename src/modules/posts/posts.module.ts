import { Module, OnModuleInit } from '@nestjs/common';
import { ResourceRegistry } from '../../core/rbac/resource-registry';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule implements OnModuleInit {
  constructor(
    private readonly registry: ResourceRegistry,
    private readonly posts: PostsService,
  ) {}

  onModuleInit(): void {
    // O core não conhece os módulos de domínio: é cada módulo que se
    // apresenta ao registry.
    this.registry.register('post', (id) => this.posts.findById(id));
  }
}
