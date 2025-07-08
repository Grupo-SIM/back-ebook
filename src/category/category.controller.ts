import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    ParseIntPipe,
    HttpCode,
    HttpStatus,
    Req
} from '@nestjs/common';
import { CategoryService } from './category.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryResponseDto, CategoryQueryDto } from './dto/category.dto';
import { JwtAuthGuardPanel } from 'src/auth/guard/jwt-auth.guard';
import { JwtAuthGuardAll } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';

@Controller('categories')
export class CategoryController {
    constructor(private readonly categoryService: CategoryService) { }

    @Post()
    @UseGuards(JwtAuthGuardPanel)
    async createCategory(
        @Body() data: CreateCategoryDto,
        @GetUser() user: any,
        @Req() req: RequestWithUser
    ): Promise<CategoryResponseDto> {
        return this.categoryService.createCategory(data);
    }

    @Get()
    @UseGuards(JwtAuthGuardAll)
    async getAllCategories(@Query() query: CategoryQueryDto): Promise<CategoryResponseDto[]> {
        return this.categoryService.getAllCategories(query);
    }

    @Get('active')
    @UseGuards(JwtAuthGuardAll)
    async getActiveCategories(): Promise<CategoryResponseDto[]> {
        return this.categoryService.getActiveCategories();
    }

    @Get('popular')
    @UseGuards(JwtAuthGuardAll)
    async getPopularCategories(@Query('limit') limit?: string): Promise<CategoryResponseDto[]> {
        const limitNumber = limit ? parseInt(limit) : 10;
        return this.categoryService.getCategoriesWithMostBooks(limitNumber);
    }

    @Get('seed')
    async seedDefaultCategories(): Promise<{ message: string }> {
        await this.categoryService.seedDefaultCategories();
        return { message: 'Categorias padrão criadas com sucesso' };
    }

    @Get(':id')
    @UseGuards(JwtAuthGuardAll)
    async getCategoryById(@Param('id', ParseIntPipe) id: number): Promise<CategoryResponseDto> {
        return this.categoryService.getCategoryById(id);
    }

    @Get('name/:name')
    @UseGuards(JwtAuthGuardAll)
    async getCategoryByName(@Param('name') name: string): Promise<CategoryResponseDto> {
        return this.categoryService.getCategoryByName(name);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuardPanel)
    async updateCategory(
        @Param('id', ParseIntPipe) id: number,
        @Body() data: UpdateCategoryDto,
        @GetUser() user: any,
        @Req() req: RequestWithUser
    ): Promise<CategoryResponseDto> {
        return this.categoryService.updateCategory(id, data);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuardPanel)
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteCategory(
        @Param('id', ParseIntPipe) id: number,
        @GetUser() user: any,
        @Req() req: RequestWithUser
    ): Promise<void> {
        await this.categoryService.deleteCategory(id);
    }
} 