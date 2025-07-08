import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsEmail, IsString, IsOptional } from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'The ID of the user associated with this admin' })
  @IsUUID()
  userId: string;
}

export class UpdateAdminDto {
  @ApiProperty({ example: 'John Doe', description: 'The name of the admin', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'john.doe@example.com', description: 'The email of the admin', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class AdminResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'The unique identifier of the admin' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'The ID of the user associated with this admin' })
  userId: string;

  @ApiProperty({ example: 'John Doe', description: 'The name of the admin' })
  name: string;

  @ApiProperty({ example: 'john.doe@example.com', description: 'The email of the admin' })
  email: string;

  @ApiProperty({ example: '2023-05-15T10:00:00.000Z', description: 'The date and time when the admin was created' })
  createdAt: Date;

  @ApiProperty({ example: '2023-05-15T10:00:00.000Z', description: 'The date and time when the admin was last updated' })
  updatedAt: Date;
}