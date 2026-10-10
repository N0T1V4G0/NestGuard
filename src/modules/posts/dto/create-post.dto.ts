import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreatePostDto {
  @ApiProperty({ example: 'Meu primeiro post' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ example: 'Conteúdo do post.' })
  @IsString()
  body!: string;
}
