import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from './redis.service';


@Injectable()
export class GenericService {
  public readonly CACHE_TTL = 600;

  constructor(
    public prisma: PrismaService,
    public redisService: RedisService
  ) {}

  async getAll(modelName: string): Promise<any[]> {
    const cacheKey = `all_${modelName}s`;
    const cachedData = await this.redisService.get(cacheKey);
    
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const items = await this.prisma[modelName].findMany();
    await this.redisService.set(cacheKey, JSON.stringify(items), this.CACHE_TTL);
    return items;
  }

  async getById(modelName: string, id: string): Promise<any | null> {
    const cacheKey = `${modelName}:${id}`;
    const cachedData = await this.redisService.get(cacheKey);
    
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const item = await this.prisma[modelName].findUnique({
      where: { id },
    });

    if (item) {
      await this.redisService.set(cacheKey, JSON.stringify(item), this.CACHE_TTL);
    }

    return item;
  }

  async create(modelName: string, data: any): Promise<any> {
    const item = await this.prisma[modelName].create({
      data,
    });

    await this.redisService.set(`${modelName}:${item.id}`, JSON.stringify(item), this.CACHE_TTL);
    await this.redisService.del(`all_${modelName}s`);

    return item;
  }

  async update(modelName: string, id: string, data: any): Promise<any> {
    const item = await this.prisma[modelName].update({
      where: { id },
      data,
    });

    await this.redisService.set(`${modelName}:${id}`, JSON.stringify(item), this.CACHE_TTL);
    await this.redisService.del(`all_${modelName}s`);

    return item;
  }

  async delete(modelName: string, id: string): Promise<any> {
    const item = await this.prisma[modelName].delete({
      where: { id },
    });

    await this.redisService.del(`${modelName}:${id}`);
    await this.redisService.del(`all_${modelName}s`);

    return item;
  }

}