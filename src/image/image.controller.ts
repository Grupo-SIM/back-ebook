/* eslint-disable prettier/prettier */
import {
  BadRequestException,
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
      const ext = extname(file.originalname).toLowerCase();
      const mime = String(file.mimetype || '').toLowerCase();
      const extOk = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
      const mimeOk =
        mime === '' ||
        mime === 'application/octet-stream' ||
        /^image\/(jpeg|jpg|png|gif|webp)$/.test(mime);

      if (extOk && mimeOk) {
        cb(null, true);
        return;
      }

      cb(
        new BadRequestException(
          `Formato de arquivo não suportado (${ext || 'sem extensão'} / ${mime || 'sem mimetype'}). Envie jpg, jpeg, png, gif ou webp.`,
        ) as any,
        false,
      );
    },
  }),
  )
   async uploadImage(@UploadedFile() file) {
      try {
          if (!file) {
            throw new BadRequestException('Nenhum arquivo enviado no campo "file".');
          }
          return await this.imageService.uploadImage(file);
      } catch (error) {
          if (error.code === 'LIMIT_FILE_SIZE') {
              throw new HttpException('Arquivo muito grande. O limite é 5MB.', 413);
          }
          throw new HttpException(error.message, error.status || 400);
      }

    }   
}
