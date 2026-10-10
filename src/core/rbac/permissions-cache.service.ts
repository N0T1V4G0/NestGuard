import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.schema';
import type { Condition, ResolvedPermissions } from './permission.types';
import type { Permission } from './permissions';

const KEY_PREFIX = 'rbac:perms:';

/**
 * Cache do conjunto efetivo de permissões.
 *
 * Opcional por desenho: com RBAC_CACHE_ENABLED=false tudo funciona sem Redis.
 * Uma falha do Redis também não derruba a autorização — o erro vai para o log
 * e a resolução cai no banco. Autorização indisponível é pior que lenta.
 */
@Injectable()
export class PermissionsCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionsCacheService.name);
  private client?: Redis;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get enabled(): boolean {
    return this.config.get('RBAC_CACHE_ENABLED', { infer: true });
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Cache de permissões desligado (RBAC_CACHE_ENABLED=false)');
      return;
    }

    this.client = new Redis(this.config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });

    // Sem este handler, um erro de conexão do ioredis sobe como 'error' não
    // tratado e derruba o processo — o oposto do que o cache deve fazer.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis indisponível, caindo no banco: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  async get(userId: string): Promise<ResolvedPermissions | null> {
    if (!this.client) {
      return null;
    }

    try {
      const raw = await this.client.get(KEY_PREFIX + userId);
      if (raw === null) {
        return null;
      }

      const entries = JSON.parse(raw) as [Permission, (Condition | null)[]][];
      return new Map(entries);
    } catch (error) {
      this.logger.warn(`Falha ao ler o cache: ${(error as Error).message}`);
      return null;
    }
  }

  async set(userId: string, resolved: ResolvedPermissions): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const ttl = this.config.get('RBAC_CACHE_TTL_SECONDS', { infer: true });
      await this.client.set(
        KEY_PREFIX + userId,
        JSON.stringify([...resolved.entries()]),
        'EX',
        ttl,
      );
    } catch (error) {
      this.logger.warn(`Falha ao gravar no cache: ${(error as Error).message}`);
    }
  }

  async invalidateUser(userId: string): Promise<void> {
    try {
      await this.client?.del(KEY_PREFIX + userId);
    } catch (error) {
      this.logger.warn(`Falha ao invalidar o cache: ${(error as Error).message}`);
    }
  }

  /**
   * Usado quando um papel muda: descobrir exatamente quais usuários são
   * afetados exigiria percorrer a hierarquia inteira, e errar nessa conta
   * deixa permissão revogada ainda valendo.
   */
  async invalidateAll(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const keys = await this.client.keys(KEY_PREFIX + '*');
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      this.logger.warn(`Falha ao limpar o cache: ${(error as Error).message}`);
    }
  }
}
