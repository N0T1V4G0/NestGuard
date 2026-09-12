import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de ao menos 8 caracteres' })
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}
