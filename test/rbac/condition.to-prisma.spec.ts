import { conditionToPrisma } from '../../src/core/rbac/condition.to-prisma';

describe('conditionToPrisma', () => {
  const user = 'user-1';

  it('traduz campo plano', () => {
    expect(conditionToPrisma({ status: 'DRAFT' }, user)).toEqual({ status: 'DRAFT' });
  });

  it('substitui $user.id', () => {
    expect(conditionToPrisma({ ownerId: '$user.id' }, user)).toEqual({ ownerId: 'user-1' });
  });

  it('combina várias chaves em conjunção', () => {
    expect(conditionToPrisma({ ownerId: '$user.id', status: 'DRAFT' }, user)).toEqual({
      ownerId: 'user-1',
      status: 'DRAFT',
    });
  });

  it('traduz um nível de relação em filtro aninhado', () => {
    expect(conditionToPrisma({ 'author.teamId': 'team-9' }, user)).toEqual({
      author: { teamId: 'team-9' },
    });
  });

  it('funde duas chaves da mesma relação', () => {
    expect(conditionToPrisma({ 'author.teamId': 't1', 'author.active': true }, user)).toEqual({
      author: { teamId: 't1', active: true },
    });
  });

  it('condição vazia vira filtro vazio', () => {
    expect(conditionToPrisma({}, user)).toEqual({});
  });

  it('lança erro explícito para relação com mais de um nível', () => {
    expect(() => conditionToPrisma({ 'a.b.c': 1 }, user)).toThrow(/um nível/i);
  });

  it('a mensagem de erro nomeia o caminho problemático', () => {
    expect(() => conditionToPrisma({ 'a.b.c': 1 }, user)).toThrow(/a\.b\.c/);
  });
});
