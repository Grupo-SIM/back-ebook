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
import { JwtAuthGuardAdmin, JwtAuthGuardAdminOrUser } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
    constructor(private readonly categoryService: CategoryService) { }

    @Post()
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Criar nova categoria',
        description: 'Cria uma nova categoria (apenas ADMIN)'
    })
    @ApiResponse({
        status: 201,
        description: 'Categoria criada com sucesso',
        type: CategoryResponseDto
    })
    @ApiResponse({
        status: 401,
        description: 'Não autorizado - Apenas ADMIN pode criar categorias'
    })
    async createCategory(
        @Body() data: CreateCategoryDto,
        @GetUser() user: any,
        @Req() req: RequestWithUser
    ): Promise<CategoryResponseDto> {
        return this.categoryService.createCategory(data);
    }

    @Get()
    @ApiOperation({
        summary: 'Listar todas as categorias',
        description: 'Lista todas as categorias (PÚBLICO)'
    })
    @ApiResponse({
        status: 200,
        description: 'Lista de categorias',
        type: [CategoryResponseDto]
    })
    async getAllCategories(@Query() query: CategoryQueryDto): Promise<CategoryResponseDto[]> {
        return this.categoryService.getAllCategories(query);
    }

    @Get('active')
    @ApiOperation({
        summary: 'Listar categorias ativas',
        description: 'Lista apenas categorias ativas (PÚBLICO)'
    })
    @ApiResponse({
        status: 200,
        description: 'Lista de categorias ativas',
        type: [CategoryResponseDto]
    })
    async getActiveCategories(): Promise<CategoryResponseDto[]> {
        return this.categoryService.getActiveCategories();
    }

    @Get('popular')
    @ApiOperation({
        summary: 'Listar categorias populares',
        description: 'Lista categorias com mais livros (PÚBLICO)'
    })
    @ApiResponse({
        status: 200,
        description: 'Lista de categorias populares',
        type: [CategoryResponseDto]
    })
    async getPopularCategories(@Query('limit') limit?: string): Promise<CategoryResponseDto[]> {
        const limitNumber = limit ? parseInt(limit) : 10;
        return this.categoryService.getCategoriesWithMostBooks(limitNumber);
    }

    @Get('seed')
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Criar categorias padrão',
        description: 'Cria categorias padrão no sistema (apenas ADMIN)'
    })
    @ApiResponse({
        status: 200,
        description: 'Categorias padrão criadas com sucesso'
    })
    async seedDefaultCategories(): Promise<{ message: string }> {
        await this.categoryService.seedDefaultCategories();
        return { message: 'Categorias padrão criadas com sucesso' };
    }

    @Get(':id')
    @ApiOperation({
        summary: 'Buscar categoria por ID',
        description: 'Busca uma categoria específica por ID (PÚBLICO)'
    })
    @ApiResponse({
        status: 200,
        description: 'Categoria encontrada',
        type: CategoryResponseDto
    })
    @ApiResponse({
        status: 404,
        description: 'Categoria não encontrada'
    })
    async getCategoryById(@Param('id', ParseIntPipe) id: number): Promise<CategoryResponseDto> {
        return this.categoryService.getCategoryById(id);
    }

    @Get('name/:name')
    @ApiOperation({
        summary: 'Buscar categoria por nome',
        description: 'Busca uma categoria específica por nome (PÚBLICO)'
    })
    @ApiResponse({
        status: 200,
        description: 'Categoria encontrada',
        type: CategoryResponseDto
    })
    @ApiResponse({
        status: 404,
        description: 'Categoria não encontrada'
    })
    async getCategoryByName(@Param('name') name: string): Promise<CategoryResponseDto> {
        return this.categoryService.getCategoryByName(name);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Atualizar categoria',
        description: 'Atualiza uma categoria existente (apenas ADMIN)'
    })
    @ApiResponse({
        status: 200,
        description: 'Categoria atualizada com sucesso',
        type: CategoryResponseDto
    })
    @ApiResponse({
        status: 401,
        description: 'Não autorizado - Apenas ADMIN pode atualizar categorias'
    })
    @ApiResponse({
        status: 404,
        description: 'Categoria não encontrada'
    })
    async updateCategory(
        @Param('id', ParseIntPipe) id: number,
        @Body() data: UpdateCategoryDto,
        @GetUser() user: any,
        @Req() req: RequestWithUser
    ): Promise<CategoryResponseDto> {
        return this.categoryService.updateCategory(id, data);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Deletar categoria',
        description: 'Remove uma categoria do sistema (apenas ADMIN)'
    })
    @ApiResponse({
        status: 204,
        description: 'Categoria deletada com sucesso'
    })
    @ApiResponse({
        status: 401,
        description: 'Não autorizado - Apenas ADMIN pode deletar categorias'
    })
    @ApiResponse({
        status: 404,
        description: 'Categoria não encontrada'
    })
    async deleteCategory(
        @Param('id', ParseIntPipe) id: number,
        @GetUser() user: any,
        @Req() req: RequestWithUser
    ): Promise<void> {
        await this.categoryService.deleteCategory(id);
    }
} 