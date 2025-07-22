/* eslint-disable prettier/prettier */
import {
  Controller,
  HttpException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import * as multer from 'multer';

import { extname } from 'path';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ImageService } from './image.service';

@ApiBearerAuth()
@Controller('image')
export class ImageControllerUser {
  constructor(private imageService: ImageService) { }

  @ApiTags('Upload')
  @ApiOperation({ summary: 'Upload de uma imagem' })
  @ApiResponse({
      type: String,
      description: 'Retorna a key da imagem',
  })

  @ApiConsumes('multipart/form-data')
  @ApiBody({
      required: true,
      schema: {
          type: 'object',
          properties: {
              file: {
                  type: 'string',
                  format: 'binary',
              },
          },
      },
  })
  @Post('upload')
  @UseInterceptors(
      FileInterceptor('file', {
    storage: multer.diskStorage({
      destination: './tmp',
      filename: (req, file, cb) => {
        const randomName = Array(32)
          .fill(null)
          .map(() => Math.round(Math.random() * 16).toString(16))
          .join('');
        cb(null, `${randomName}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowedTypes = /jpeg|jpg|png|gif/;
      const ext = extname(file.originalname).toLowerCase();
      if (allowedTypes.test(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Formato de arquivo não suportado. Envie uma imagem jpg, jpeg, png ou gif.'), false);
      }
    },
  }),
  )
   async uploadImage(@UploadedFile() file) {
      try {
          return await this.imageService.uploadImage(file);
      } catch (error) {
          if (error.code === 'LIMIT_FILE_SIZE') {
              throw new HttpException('Arquivo muito grande. O limite é 2MB.', 413);
          }
          throw new HttpException(error.message, error.status || 400);
      }

    }   
}
