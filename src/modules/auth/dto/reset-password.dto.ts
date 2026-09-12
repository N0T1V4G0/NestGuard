import { IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @Length(64, 64)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de ao menos 8 caracteres' })
  password!: string;
}
