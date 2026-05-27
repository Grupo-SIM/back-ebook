import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { isValidDocument } from '../utils/cpf.util';

export function IsDocument(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isDocument',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          return isValidDocument(value);
        },
        defaultMessage(_args: ValidationArguments) {
          return 'CPF ou CNPJ inválido';
        },
      },
    });
  };
}
