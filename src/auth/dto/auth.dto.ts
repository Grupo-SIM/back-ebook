import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';
import { Role } from 'src/types/interfaces/role';

export class LoginInputDTO {
  @ApiProperty({ nullable: false, name: 'email', type: () => String })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ nullable: false, name: 'password', type: () => String })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RegisterInputDTO {
  @ApiProperty({ nullable: false, name: 'email', type: () => String })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ nullable: false, name: 'name', type: () => String })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ nullable: false, name: 'password', type: () => String })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ nullable: false, name: 'confirmPassword', type: () => String })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;

  @ApiProperty({
    enum: ['ADMIN', 'USER', 'CUSTOMER'],
    default: 'USER', // Remova isso se a role for sempre obrigatória e sem default
    type: () => String,
  })
  @IsNotEmpty() // Certifique-se de que é @IsNotEmpty() e não @IsOptional()
  @IsString()
  role: 'ADMIN' | 'USER' | 'CUSTOMER';
}

export class UpdatePasswordInputDTO {
  @ApiProperty({ nullable: false, name: 'oldPassword', type: () => String })
  @IsString()
  @IsNotEmpty()
  oldPassword: string;

  @ApiProperty({ nullable: false, name: 'password', type: () => String })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ nullable: false, name: 'confirmPassword', type: () => String })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}

export class UpdateRecoveryPasswordInputDTO {
  @ApiProperty({ nullable: false, name: 'password', type: () => String })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ nullable: false, name: 'confirmPassword', type: () => String })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}

export class UpdatePassInputDTO {
  @ApiProperty({ nullable: false, name: 'password', type: () => String })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ nullable: false, name: 'confirmPassword', type: () => String })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}

export class PayloadAuth {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ nullable: false, name: 'id', type: () => String })
  id: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ nullable: false, name: 'name', type: () => String })
  name: string;

  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ nullable: false, name: 'email', type: () => String })
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ nullable: false, name: 'role', type: () => String })
  role: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ nullable: true, name: 'createdById', type: () => String, description: 'ID of the user who created this account' })
  createdById?: string;
}

export class AuthOutputDTO {
  @ApiProperty({ description: 'JWT token de autenticação' })
  token: string;

  @ApiProperty({ description: 'Dados do usuário autenticado ou criado' })
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: Date;
    updatedAt: Date;
    isActive: boolean;
    createdById: string | null;
    admin?: any;
  };
}

export class PasswordRecoveryLinkDTO {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ name: 'email', type: () => String, nullable: false })
  email: string;
}

export class NewPasswordDTO {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ name: 'password', type: () => String, nullable: false })
  password: string;

  @ApiProperty({ name: 'confirmPassword', type: () => String, nullable: false })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}

export class CreateUserInputDTO {
  @ApiProperty({ nullable: false, name: 'email', type: () => String })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ nullable: false, name: 'name', type: () => String })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ nullable: false, name: 'password', type: () => String })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ nullable: false, name: 'confirmPassword', type: () => String })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;

  @ApiProperty({
    enum: ['ADMIN', 'USER', 'CUSTOMER'],
    default: 'USER',
    type: () => String,
    description: 'Role do usuário (ADMIN, USER ou CUSTOMER)'
  })
  @IsOptional()
  @IsString()
  @IsIn(['ADMIN', 'USER', 'CUSTOMER'])
  role?: 'ADMIN' | 'USER' | 'CUSTOMER' = 'USER';
}