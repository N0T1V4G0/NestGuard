import { evaluateCondition } from '../../src/core/rbac/condition.evaluator';

describe('evaluateCondition', () => {
  const user = 'user-1';
  const post = { id: 'p1', ownerId: 'user-1', status: 'DRAFT', views: 10 };

  it('aprova quando o campo bate', () => {
    expect(evaluateCondition({ status: 'DRAFT' }, post, user)).toBe(true);
  });

  it('reprova quando o campo não bate', () => {
    expect(evaluateCondition({ status: 'PUBLISHED' }, post, user)).toBe(false);
  });

  it('substitui $user.id pelo id de quem pede', () => {
    expect(evaluateCondition({ ownerId: '$user.id' }, post, user)).toBe(true);
    expect(evaluateCondition({ ownerId: '$user.id' }, post, 'outro')).toBe(false);
  });

  it('exige que todas as chaves batam', () => {
    expect(evaluateCondition({ ownerId: '$user.id', status: 'DRAFT' }, post, user)).toBe(true);
    expect(evaluateCondition({ ownerId: '$user.id', status: 'PUBLISHED' }, post, user)).toBe(false);
  });

  it('condição vazia aprova', () => {
    expect(evaluateCondition({}, post, user)).toBe(true);
  });

  it('reprova campo que não existe no recurso', () => {
    expect(evaluateCondition({ inexistente: 'x' }, post, user)).toBe(false);
  });

  it('resolve um nível de relação', () => {
    const comRelacao = { id: 'c1', author: { teamId: 'team-9' } };
    expect(evaluateCondition({ 'author.teamId': 'team-9' }, comRelacao, user)).toBe(true);
    expect(evaluateCondition({ 'author.teamId': 'team-0' }, comRelacao, user)).toBe(false);
  });

  it('reprova quando a relação não foi carregada', () => {
    expect(evaluateCondition({ 'author.teamId': 'team-9' }, post, user)).toBe(false);
  });

  it('compara por igualdade estrita, sem coerção', () => {
    expect(evaluateCondition({ views: '10' }, post, user)).toBe(false);
    expect(evaluateCondition({ views: 10 }, post, user)).toBe(true);
  });

  it('não confunde null com ausente', () => {
    const comNulo = { id: 'p2', tenantId: null };
    expect(evaluateCondition({ tenantId: null }, comNulo, user)).toBe(true);
    expect(evaluateCondition({ outroCampo: null }, comNulo, user)).toBe(false);
  });
});
