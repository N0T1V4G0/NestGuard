import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ minLength: 64, maxLength: 64, description: 'Token recebido por e-mail' })
  @IsString()
  @Length(64, 64)
  token!: string;

  @ApiProperty({ example: 'NovaSenhaForte123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'A senha precisa de ao menos 8 caracteres' })
  password!: string;
}
