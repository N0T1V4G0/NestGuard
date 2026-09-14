import { Injectable } from '@nestjs/common';
import { Post, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { title: string; body: string; ownerId: string }): Promise<Post> {
    return this.prisma.post.create({ data });
  }

  findById(id: string): Promise<Post | null> {
    return this.prisma.post.findUnique({ where: { id } });
  }

  /**
   * `where` vem do `scopeFor()` e carrega a autorização de listagem. Aceitar o
   * fragmento aqui é o que mantém a regra de acesso num lugar só.
   */
  findMany(where: Prisma.PostWhereInput = {}): Promise<Post[]> {
    return this.prisma.post.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  update(id: string, data: { title?: string; body?: string }): Promise<Post> {
    return this.prisma.post.update({ where: { id }, data });
  }

  publish(id: string): Promise<Post> {
    return this.prisma.post.update({ where: { id }, data: { status: 'PUBLISHED' } });
  }

  delete(id: string): Promise<Post> {
    return this.prisma.post.delete({ where: { id } });
  }
}
