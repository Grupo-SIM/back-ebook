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
    UseInterceptors,
    UploadedFile,
    Req,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiConsumes,
    ApiBody,
} from '@nestjs/swagger';
import { BookService } from './book.service';
import { CreateBookDto, UpdateBookDto, BookResponseDto, BookQueryDto, PaginatedBookResponseDto } from './dto/book.dto';
import { JwtAuthGuardAdmin } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';

@ApiTags('Admin Books')
@Controller('admin/books')
@UseGuards(JwtAuthGuardAdmin)
@ApiBearerAuth()
export class AdminBookController {
    constructor(private readonly bookService: BookService) { }

    @Get()
    @ApiOperation({ summary: 'Listar livros do admin autenticado' })
    @ApiResponse({ status: 200, type: PaginatedBookResponseDto })
    async getMyBooks(
        @Query() query: BookQueryDto,
        @GetUser() admin: RequestWithUser['user'],
    ): Promise<PaginatedBookResponseDto> {
        return this.bookService.getAllBooks({ ...query, createdById: admin.id }, admin.id, true);
    }

    @Get('purchased')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar livros comprados/liberados do admin autenticado (apenas livros criados por ele)' })
    async getPurchasedBooks(
        @Query() query: BookQueryDto,
        @GetUser() admin: RequestWithUser['user'],
    ): Promise<PaginatedBookResponseDto> {
        // Só livros criados pelo admin
        return this.bookService.getPurchasedBooks({ ...query, createdById: admin.id }, admin.id);
    }

    @Get('free')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar livros gratuitos criados pelo admin autenticado' })
    async getFreeBooks(
        @Query() query: BookQueryDto,
        @GetUser() admin: RequestWithUser['user'],
    ) {
        return this.bookService.getAllBooks({ ...query, type: 'free', createdById: admin.id }, admin.id, true);
    }

    @Get('paid')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar livros pagos criados pelo admin autenticado' })
    async getPaidBooks(
        @Query() query: BookQueryDto,
        @GetUser() admin: RequestWithUser['user'],
    ) {
        return this.bookService.getAllBooks({ ...query, type: 'paid', createdById: admin.id }, admin.id, true);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obter livro do admin por ID' })
    @ApiResponse({ status: 200, type: BookResponseDto })
    async getMyBookById(
        @Param('id', ParseIntPipe) id: number,
        @GetUser() admin: RequestWithUser['user'],
    ): Promise<BookResponseDto> {
        return this.bookService.getBookById(id, admin.id, true);
    }

    @Post()
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                author: { type: 'string' },
                price: { type: 'number' },
                originalPrice: { type: 'number' },
                rating: { type: 'number' },
                reviewCount: { type: 'number' },
                categoryId: { type: 'number' },
                cover: { type: 'string' },
                description: { type: 'string' },
                sales: { type: 'number' },
                language: { type: 'string' },
                isbn: { type: 'string' },
                publisher: { type: 'string' },
                publishedDate: { type: 'string' },
                printLength: { type: 'number' },
                readingAge: { type: 'string' },
                file: { type: 'string', format: 'binary' }
            }
        }
    })
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: './uploads/books',
            filename: (req, file, cb) => {
                const ext = path.extname(file.originalname);
                const name = path.basename(file.originalname, ext).replace(/\s/g, '_');
                cb(null, `${name}_${Date.now()}${ext}`);
            }
        }),
        fileFilter: (req, file, cb) => {
            const allowed = ['.pdf', '.epub', '.mobi'];
            const ext = path.extname(file.originalname).toLowerCase();
            if (allowed.includes(ext)) cb(null, true);
            else cb(new Error('Only PDF, EPUB, MOBI allowed'), false);
        }
    }))
    async createBook(
        @Body() createBookDto: CreateBookDto,
        @GetUser() admin: RequestWithUser['user'],
        @UploadedFile() file?: Express.Multer.File
    ): Promise<BookResponseDto> {
        let downloadUrl: string | undefined = undefined;
        if (file) {
            downloadUrl = `/uploads/books/${file.filename}`;
        }
        return this.bookService.createBook({ ...createBookDto, downloadUrl }, admin.id);
    }

    @Put(':id')
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                author: { type: 'string' },
                price: { type: 'number' },
                originalPrice: { type: 'number' },
                rating: { type: 'number' },
                reviewCount: { type: 'number' },
                categoryId: { type: 'number' },
                cover: { type: 'string' },
                description: { type: 'string' },
                sales: { type: 'number' },
                language: { type: 'string' },
                isbn: { type: 'string' },
                publisher: { type: 'string' },
                publishedDate: { type: 'string' },
                printLength: { type: 'number' },
                file: { type: 'string', format: 'binary' }
            }
        }
    })
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: './uploads/books',
            filename: (req, file, cb) => {
                const ext = path.extname(file.originalname);
                const name = path.basename(file.originalname, ext).replace(/\s/g, '_');
                cb(null, `${name}_${Date.now()}${ext}`);
            }
        }),
        fileFilter: (req, file, cb) => {
            const allowed = ['.pdf', '.epub', '.mobi'];
            const ext = path.extname(file.originalname).toLowerCase();
            if (allowed.includes(ext)) cb(null, true);
            else cb(new Error('Only PDF, EPUB, MOBI allowed'), false);
        }
    }))
    async updateBook(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateBookDto: UpdateBookDto,
        @GetUser() admin: RequestWithUser['user'],
        @UploadedFile() file?: Express.Multer.File
    ): Promise<BookResponseDto> {
        let downloadUrl: string | undefined = undefined;
        if (file) {
            downloadUrl = `/uploads/books/${file.filename}`;
        }
        return this.bookService.updateBook(id, { ...updateBookDto, ...(downloadUrl ? { downloadUrl } : {}) }, admin.id, true);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Deletar livro do admin autenticado' })
    @ApiResponse({ status: 200, type: BookResponseDto })
    async deleteBook(
        @Param('id', ParseIntPipe) id: number,
        @GetUser() admin: RequestWithUser['user'],
    ): Promise<BookResponseDto> {
        return this.bookService.deleteBook(id, admin.id, true);
    }
} 