import { PasswordService } from '../../src/core/crypto/password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('gera um hash no formato argon2id', async () => {
    const hash = await service.hash('senha-secreta');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('gera hashes diferentes para a mesma senha (salt aleatório)', async () => {
    const a = await service.hash('senha-secreta');
    const b = await service.hash('senha-secreta');
    expect(a).not.toBe(b);
  });

  it('verifica uma senha correta', async () => {
    const hash = await service.hash('senha-secreta');
    await expect(service.verify(hash, 'senha-secreta')).resolves.toBe(true);
  });

  it('rejeita uma senha incorreta', async () => {
    const hash = await service.hash('senha-secreta');
    await expect(service.verify(hash, 'senha-errada')).resolves.toBe(false);
  });

  it('retorna false em vez de lançar quando o hash é malformado', async () => {
    await expect(service.verify('nao-e-um-hash', 'qualquer')).resolves.toBe(false);
  });

  it('nunca devolve a senha em texto puro dentro do hash', async () => {
    const hash = await service.hash('senha-secreta');
    expect(hash).not.toContain('senha-secreta');
  });
});
