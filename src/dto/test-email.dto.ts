import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class TestEmailDto {
  @ApiProperty({
    description: 'Email de destino para receber o email de teste',
    example: 'seu_email@gmail.com',
    required: true,
  })
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty({ message: 'Email é obrigatório' })
  email: string;
}
