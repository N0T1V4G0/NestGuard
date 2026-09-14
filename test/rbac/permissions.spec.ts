import { ALL_PERMISSIONS, isPermission, PERMISSIONS } from '../../src/core/rbac/permissions';

describe('Catálogo de permissões', () => {
  it('compõe o bloco declarado pelo módulo posts', () => {
    expect(PERMISSIONS.post).toBeDefined();
    expect(PERMISSIONS.post).toContain('update');
  });

  it('achata o catálogo em pares recurso:ação', () => {
    expect(ALL_PERMISSIONS).toContain('post:update');
    expect(ALL_PERMISSIONS).toContain('post:publish');
  });

  it('não produz duplicatas', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('reconhece uma permissão válida', () => {
    expect(isPermission('post:update')).toBe(true);
  });

  it('rejeita uma permissão inexistente', () => {
    expect(isPermission('post:updaet')).toBe(false);
    expect(isPermission('invoice:refund')).toBe(false);
    expect(isPermission('post')).toBe(false);
    expect(isPermission('')).toBe(false);
  });

  it('toda entrada segue o formato recurso:acao', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z][a-zA-Z0-9]*:[a-z][a-zA-Z0-9]*$/);
    }
  });
});
