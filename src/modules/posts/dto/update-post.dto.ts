import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdatePostDto {
  @ApiPropertyOptional({ example: 'Título revisado' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ example: 'Conteúdo revisado.' })
  @IsOptional()
  @IsString()
  body?: string;
}
