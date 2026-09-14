import { Injectable } from '@nestjs/common';

export type ResourceLoader = (id: string) => Promise<Record<string, unknown> | null>;

/**
 * Diz ao guard como carregar cada recurso protegido.
 *
 * Cada módulo registra o seu no `onModuleInit`, o que evita que o core
 * conheça os módulos de domínio — o acoplamento fica na direção certa, e
 * apagar um módulo não deixa referência órfã no core.
 */
@Injectable()
export class ResourceRegistry {
  private readonly loaders = new Map<string, ResourceLoader>();

  register(name: string, loader: ResourceLoader): void {
    this.loaders.set(name, loader);
  }

  async load(name: string, id: string): Promise<Record<string, unknown> | null> {
    const loader = this.loaders.get(name);

    if (!loader) {
      // Erro de programação, não do usuário: @RequirePermission aponta para um
      // recurso que ninguém registrou. Falhar alto é melhor que negar acesso
      // silenciosamente e mandar o dev procurar no lugar errado.
      throw new Error(
        `Recurso "${name}" não registrado no ResourceRegistry. ` +
          'Registre-o no onModuleInit do módulo correspondente.',
      );
    }

    return loader(id);
  }

  has(name: string): boolean {
    return this.loaders.has(name);
  }
}
