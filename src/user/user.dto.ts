import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsEnum } from 'class-validator';
import { Role } from 'src/types/interfaces/role';

export class CreateUserDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'securePassword123' })
  @IsString()
  password: string;

  @ApiProperty({ example: 'securePassword123' })
  @IsString()
  confirmPassword: string;

  @ApiProperty({
    enum: Role,
    example: Role.USER,
    description: 'Role of the user'
  })
  @IsEnum(Role)
  role: Role;
}

export class UpdateUserDto {
  @ApiProperty({ example: 'John Doe Updated', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', required: false, description: 'URL da imagem de avatar' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class UserResponseDto {
  @ApiProperty({ example: 'bb8c795a-e134-4428-9dc6-ac5a5b774dcf' })
  id: string;

  @ApiProperty({ example: 'bb8c795a-e134-4428-9dc6-ac5a5b774dcf' })
  userId: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.USER })
  role: Role;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', required: false, description: 'URL da imagem de avatar' })
  avatarUrl?: string;

  @ApiProperty({
    example: {
      id: 'creator-id',
      name: 'Creator Name',
      email: 'creator@example.com'
    },
    required: false,
    description: 'Information about who created this user'
  })
  createdBy?: {
    id: string;
    name: string;
    email: string;
  };
}