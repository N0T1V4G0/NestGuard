import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class RequestResetDto {
  @ApiProperty({ example: 'maria@example.com' })
  @IsEmail()
  email!: string;
}
