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
import { CreateBookDto, UpdateBookDto, BookResponseDto, BookQueryDto, PaginatedBookResponseDto, CreateReviewDto, ReviewResponseDto, PaginatedReviewsResponseDto } from './dto/book.dto';
import { JwtAuthGuardAll, JwtAuthGuardAdmin } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';

@Controller('books')
@ApiTags('Books')
export class BookController {
    constructor(private readonly bookService: BookService) { }

    @Post()
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create a new book' })
    async createBook(
        @Body() createBookDto: CreateBookDto,
        @GetUser() user: RequestWithUser['user'],
    ): Promise<BookResponseDto> {
        return this.bookService.createBook(createBookDto, user.id);
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
    async getAllBooks(
        @Query() query: BookQueryDto,
        @GetUser() user?: RequestWithUser['user'],
    ): Promise<PaginatedBookResponseDto> {
        return this.bookService.getAllBooks(query, user?.id);
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
        @GetUser() user?: RequestWithUser['user'],
    ): Promise<PaginatedBookResponseDto> {
        return this.bookService.searchBooks(query, pagination, user?.id);
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
        @GetUser() user?: RequestWithUser['user'],
    ): Promise<PaginatedBookResponseDto> {
        return this.bookService.getBooksByCategoryId(Number(categoryId), query, user?.id);
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

    @Post('update-free-status')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Atualizar status isFree de todos os livros baseado no preço' })
    @ApiResponse({
        status: 200,
        description: 'Status isFree atualizado com sucesso'
    })
    async updateFreeStatus() {
        return this.bookService.updateFreeStatus();
    }

    @Post('activate-all')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Ativar todos os livros inativos' })
    @ApiResponse({
        status: 200,
        description: 'Todos os livros ativados com sucesso'
    })
    async activateAllBooks() {
        return this.bookService.activateAllBooks();
    }

    @Get('debug/all')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar todos os livros sem filtros (debug)' })
    async getAllBooksDebug() {
        return this.bookService.getAllBooksDebug();
    }

    @Get('debug/all-without-filters')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar todos os livros sem filtros (incluindo inativos)' })
    async getAllBooksWithoutFilters() {
        return this.bookService.getAllBooksWithoutFilters();
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

    @Get('free')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar livros gratuitos' })
    async getFreeBooks(
        @Query() query: BookQueryDto,
        @GetUser() user?: RequestWithUser['user'],
    ) {
        return this.bookService.getAllBooks({ ...query, type: 'free' }, user?.id);
    }

    @Get('paid')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar livros pagos' })
    async getPaidBooks(
        @Query() query: BookQueryDto,
        @GetUser() user?: RequestWithUser['user'],
    ) {
        return this.bookService.getAllBooks({ ...query, type: 'paid' }, user?.id);
    }

    @Get('purchased')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar livros comprados/liberados do usuário autenticado' })
    @ApiResponse({
        status: 200,
        description: 'Lista paginada de livros comprados/liberados',
        type: PaginatedBookResponseDto,
    })
    async getPurchasedBooks(
        @Query() query: BookQueryDto,
        @GetUser() user: RequestWithUser['user'],
    ): Promise<PaginatedBookResponseDto> {
        return this.bookService.getPurchasedBooks(query, user.id);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Obter livro por ID' })
    @ApiResponse({ status: 200, description: 'Livro encontrado', type: BookResponseDto })
    @ApiResponse({ status: 404, description: 'Book not found' })
    async getBookById(
        @Param('id') id: string,
        @GetUser() user?: RequestWithUser['user'],
    ): Promise<BookResponseDto> {
        return this.bookService.getBookById(Number(id), user?.id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Atualizar livro por ID (apenas ADMIN)' })
    @ApiParam({ name: 'id', description: 'ID do livro' })
    @ApiResponse({ status: 200, description: 'Livro atualizado com sucesso', type: BookResponseDto })
    @ApiResponse({ status: 404, description: 'Book not found' })
    async updateBook(
        @Param('id') id: string,
        @Body() updateBookDto: UpdateBookDto,
    ): Promise<BookResponseDto> {
        return this.bookService.updateBook(Number(id), updateBookDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Deletar livro por ID (apenas ADMIN)' })
    @ApiParam({ name: 'id', description: 'ID do livro' })
    @ApiResponse({ status: 200, description: 'Livro deletado com sucesso', type: BookResponseDto })
    @ApiResponse({ status: 404, description: 'Book not found' })
    async deleteBook(
        @Param('id') id: string,
        @GetUser() user: RequestWithUser['user'],
    ): Promise<BookResponseDto> {
        return this.bookService.deleteBook(Number(id), user.id);
    }

    @Post(':bookId/reviews')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Criar review para um livro (só para quem comprou)' })
    async createReview(
        @Param('bookId', ParseIntPipe) bookId: number,
        @Body() dto: CreateReviewDto,
        @GetUser() user: RequestWithUser['user'],
    ): Promise<ReviewResponseDto> {
        return this.bookService.createReview(bookId, user.id, dto);
    }

    @Get(':bookId/reviews')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar reviews de um livro' })
    async getReviews(
        @Param('bookId') bookId: number,
        @Query('page') page = 1,
        @Query('limit') limit = 10,
    ): Promise<PaginatedReviewsResponseDto> {
        return this.bookService.getReviews(bookId, Number(page), Number(limit));
    }
} 