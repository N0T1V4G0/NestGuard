import { TokenService } from '../../src/core/crypto/token.service';

describe('TokenService', () => {
  const service = new TokenService();

  it('gera um token de 64 caracteres hexadecimais', () => {
    const { token } = service.generate();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gera tokens diferentes a cada chamada', () => {
    expect(service.generate().token).not.toBe(service.generate().token);
  });

  it('devolve o hash correspondente ao token gerado', () => {
    const { token, tokenHash } = service.generate();
    expect(tokenHash).toBe(service.hash(token));
  });

  it('produz hash SHA-256 determinístico', () => {
    expect(service.hash('abc')).toBe(service.hash('abc'));
    expect(service.hash('abc')).not.toBe(service.hash('abd'));
  });

  it('nunca devolve o hash igual ao token', () => {
    const { token, tokenHash } = service.generate();
    expect(tokenHash).not.toBe(token);
  });

  it('produz hash de 64 caracteres hexadecimais', () => {
    expect(service.hash('qualquer-entrada')).toMatch(/^[a-f0-9]{64}$/);
  });
});
