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
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiParam,
    ApiQuery,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { BookService } from './book.service';
import { CreateBookDto, UpdateBookDto, BookResponseDto, BookQueryDto, PaginatedBookResponseDto } from './dto/book.dto';
import { JwtAuthGuardPanel } from 'src/auth/guard/jwt-auth.guard';
import { JwtAuthGuardAll } from 'src/auth/guard/jwt-auth.guard';

@Controller('books')
@ApiTags('Books')
export class BookController {
    constructor(private readonly bookService: BookService) { }

    @Post()
    @UseGuards(JwtAuthGuardPanel)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create a new book' })
    @ApiResponse({
        status: 201,
        description: 'Book created successfully',
        type: BookResponseDto,
    })
    async createBook(@Body() createBookDto: CreateBookDto): Promise<BookResponseDto> {
        return this.bookService.createBook(createBookDto);
    }

    @Get()
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get all books with pagination and filters' })
    @ApiResponse({
        status: 200,
        description: 'Paginated list of books',
        type: PaginatedBookResponseDto,
    })
    async getAllBooks(@Query() query: BookQueryDto): Promise<PaginatedBookResponseDto> {
        return this.bookService.getAllBooks(query);
    }

    @Get('search')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Search books by query with pagination' })
    @ApiQuery({ name: 'q', description: 'Search query', type: String })
    @ApiResponse({
        status: 200,
        description: 'Paginated search results',
        type: PaginatedBookResponseDto,
    })
    async searchBooks(
        @Query('q') query: string,
        @Query() pagination: BookQueryDto,
    ): Promise<PaginatedBookResponseDto> {
        return this.bookService.searchBooks(query, pagination);
    }

    @Get('category/:categoryId')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get books by category ID with pagination and filters' })
    @ApiParam({ name: 'categoryId', description: 'Category ID' })
    @ApiResponse({
        status: 200,
        description: 'Paginated books in the specified category',
        type: PaginatedBookResponseDto,
    })
    async getBooksByCategory(
        @Param('categoryId') categoryId: string,
        @Query() query: BookQueryDto,
    ): Promise<PaginatedBookResponseDto> {
        return this.bookService.getBooksByCategoryId(Number(categoryId), query);
    }

    @Get('on-sale')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get books on sale (with discount) with pagination' })
    @ApiResponse({
        status: 200,
        description: 'Paginated books currently on sale',
        type: PaginatedBookResponseDto,
    })
    async getBooksOnSale(@Query() query: BookQueryDto): Promise<PaginatedBookResponseDto> {
        return this.bookService.getBooksOnSale(query);
    }

    @Get('top-selling')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get top selling books' })
    @ApiQuery({ name: 'limit', description: 'Number of books to return', required: false, type: Number })
    @ApiResponse({
        status: 200,
        description: 'Top selling books',
        type: [BookResponseDto],
    })
    async getTopSellingBooks(@Query('limit') limit?: number): Promise<BookResponseDto[]> {
        return this.bookService.getTopSellingBooks(limit);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get book by ID' })
    @ApiParam({ name: 'id', description: 'Book ID' })
    @ApiResponse({
        status: 200,
        description: 'Book details',
        type: BookResponseDto,
    })
    @ApiResponse({
        status: 404,
        description: 'Book not found',
    })
    async getBookById(@Param('id') id: string): Promise<BookResponseDto> {
        return this.bookService.getBookById(Number(id));
    }

    @Put(':id')
    @UseGuards(JwtAuthGuardPanel)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update book by ID' })
    @ApiParam({ name: 'id', description: 'Book ID' })
    @ApiResponse({
        status: 200,
        description: 'Book updated successfully',
        type: BookResponseDto,
    })
    @ApiResponse({
        status: 404,
        description: 'Book not found',
    })
    async updateBook(
        @Param('id') id: string,
        @Body() updateBookDto: UpdateBookDto,
    ): Promise<BookResponseDto> {
        return this.bookService.updateBook(Number(id), updateBookDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuardPanel)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete book by ID' })
    @ApiParam({ name: 'id', description: 'Book ID' })
    @ApiResponse({
        status: 200,
        description: 'Book deleted successfully',
        type: BookResponseDto,
    })
    @ApiResponse({
        status: 404,
        description: 'Book not found',
    })
    async deleteBook(@Param('id') id: string): Promise<BookResponseDto> {
        return this.bookService.deleteBook(Number(id));
    }
} 