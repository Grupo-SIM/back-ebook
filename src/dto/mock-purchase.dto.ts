import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class MockPurchaseDto {
  @ApiProperty({
    description: 'ID do livro a ser "comprado"',
    example: 1,
    required: true,
  })
  @IsNumber({}, { message: 'bookId deve ser um número' })
  @IsNotEmpty({ message: 'bookId é obrigatório' })
  bookId: number;

  @ApiProperty({
    description: 'ID do usuário que está "comprando"',
    example: 'uuid-do-usuario',
    required: true,
  })
  @IsString({ message: 'userId deve ser uma string' })
  @IsNotEmpty({ message: 'userId é obrigatório' })
  userId: string;

  @ApiProperty({
    description: 'Quantidade de livros (opcional)',
    example: 1,
    required: false,
    default: 1,
  })
  @IsNumber({}, { message: 'quantity deve ser um número' })
  quantity?: number;
}
