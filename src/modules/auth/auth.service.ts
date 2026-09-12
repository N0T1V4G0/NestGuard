import { ConflictException, Injectable } from '@nestjs/common';
import { PasswordService } from '../../core/crypto/password.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('E-mail já cadastrado');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
    });

    // Devolve apenas o que o cliente precisa: nunca o registro inteiro, que
    // carrega o passwordHash.
    return { id: user.id, email: user.email };
  }
}
