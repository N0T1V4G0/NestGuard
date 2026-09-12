import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Tokens opacos para refresh, verificação de e-mail e reset de senha.
 *
 * O valor bruto vai para o usuário uma única vez; o banco guarda apenas o
 * hash. Um vazamento do banco não entrega tokens utilizáveis.
 */
@Injectable()
export class TokenService {
  generate(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    // SHA-256 sem salt é adequado aqui, diferente de senha: a entrada tem 256
    // bits de entropia aleatória, então não há o que quebrar por dicionário.
    return createHash('sha256').update(token).digest('hex');
  }
}
