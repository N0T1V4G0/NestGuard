import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ minLength: 64, maxLength: 64, description: 'Token recebido por e-mail' })
  @IsString()
  @Length(64, 64)
  token!: string;
}
