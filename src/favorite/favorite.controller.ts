import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    ParseIntPipe,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiParam,
    ApiQuery,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { FavoriteService } from './favorite.service';
import {
    AddFavoriteDto,
    RemoveFavoriteDto,
    FavoriteQueryDto,
    FavoriteItemDto,
    FavoritesResponseDto,
    FavoriteStatusDto
} from './dto/favorite.dto';
import { JwtAuthGuardAll } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';

@Controller('favorites')
@ApiTags('Favorites')
@UseGuards(JwtAuthGuardAll)
@ApiBearerAuth()
export class FavoriteController {
    constructor(private readonly favoriteService: FavoriteService) { }

    @Post()
    @ApiOperation({ summary: 'Add book to favorites' })
    @ApiResponse({
        status: 201,
        description: 'Book added to favorites successfully',
        type: FavoriteItemDto,
    })
    @ApiResponse({
        status: 404,
        description: 'Book not found',
    })
    @ApiResponse({
        status: 409,
        description: 'Book already in favorites',
    })
    async addFavorite(
        @Body() data: AddFavoriteDto,
        @GetUser() user: any,
    ): Promise<FavoriteItemDto> {
        return this.favoriteService.addFavorite(user.id, data);
    }

    @Delete()
    @ApiOperation({ summary: 'Remove book from favorites' })
    @ApiResponse({
        status: 204,
        description: 'Book removed from favorites successfully',
    })
    @ApiResponse({
        status: 404,
        description: 'Favorite not found',
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    async removeFavorite(
        @Body() data: RemoveFavoriteDto,
        @GetUser() user: any,
    ): Promise<void> {
        await this.favoriteService.removeFavorite(user.id, data);
    }

    @Get()
    @ApiOperation({ summary: 'Get user favorites with pagination and filters' })
    @ApiQuery({ name: 'page', description: 'Page number', required: false, type: Number })
    @ApiQuery({ name: 'limit', description: 'Items per page', required: false, type: Number })
    @ApiQuery({
        name: 'sortBy',
        description: 'Sort order',
        required: false,
        enum: ['recent', 'alphabetical', 'price-low', 'price-high', 'rating']
    })
    @ApiQuery({ name: 'filterCategory', description: 'Filter by category', required: false })
    @ApiResponse({
        status: 200,
        description: 'User favorites',
        type: FavoritesResponseDto,
    })
    async getFavorites(
        @Query() query: FavoriteQueryDto,
        @GetUser() user: any,
    ): Promise<FavoritesResponseDto> {
        return this.favoriteService.getFavorites(user.id, query);
    }

    @Get('count')
    @ApiOperation({ summary: 'Get user favorites count' })
    @ApiResponse({
        status: 200,
        description: 'Favorites count',
        schema: {
            type: 'object',
            properties: {
                count: { type: 'number', example: 5 },
            },
        },
    })
    async getFavoritesCount(@GetUser() user: any): Promise<{ count: number }> {
        return this.favoriteService.getFavoritesCount(user.id);
    }

    @Get('status/:bookId')
    @ApiOperation({ summary: 'Check if book is in user favorites' })
    @ApiParam({ name: 'bookId', description: 'Book ID' })
    @ApiResponse({
        status: 200,
        description: 'Favorite status',
        type: FavoriteStatusDto,
    })
    async getFavoriteStatus(
        @Param('bookId', ParseIntPipe) bookId: number,
        @GetUser() user: any,
    ): Promise<FavoriteStatusDto> {
        return this.favoriteService.getFavoriteStatus(user.id, bookId);
    }

    @Delete('clear')
    @ApiOperation({ summary: 'Clear all user favorites' })
    @ApiResponse({
        status: 204,
        description: 'All favorites cleared successfully',
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    async clearFavorites(@GetUser() user: any): Promise<void> {
        await this.favoriteService.clearFavorites(user.id);
    }
} 