/* eslint-disable prettier/prettier */
import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { deleteByKey, getUrlImageByKey, uploadFileS3 } from 'src/common/storj';

@Injectable()
export class ImageService {
    [x: string]: any;
    constructor(private prismaService: PrismaService) { }

    async uploadImage(file: any) {
        try {
            const key = await uploadFileS3(file);
            const img = await this.prismaService.image.create({
                data: {
                    key,
                    url: getUrlImageByKey(key)
                }
            });
            return {
                id: img.id,
                key: key,
                url: getUrlImageByKey(key)
            }
        } catch (error) {
            throw new HttpException(error.message, error.statu)
        }
    }

    async deleteImg(id: string) {
        const img = await this.prismaService.image.findUnique({
            where: {
                id
            },
            select: {
                key: true
            }
        })
        await deleteByKey(img.key);
        await this.prismaService.image.delete({
            where: {
                id: id
            }
        })
    }
    
}
