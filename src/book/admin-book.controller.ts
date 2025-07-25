import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
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
                publisher: { type: 'string' },
                publishedDate: { type: 'string' },
                printLength: { type: 'number' },
                readingAge: { type: 'string' },
                isActive: { type: 'boolean' },
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

    @Put(':id/toggle-status')
    @ApiOperation({ summary: 'Ativar ou desativar (toggle) o status de um livro do admin autenticado' })
    @ApiResponse({ status: 200, type: BookResponseDto })
    async toggleBookStatus(
        @Param('id', ParseIntPipe) id: number,
        @GetUser() admin: RequestWithUser['user'],
    ): Promise<BookResponseDto> {
        // Buscar o livro
        const book = await this.bookService.getBookById(id, admin.id, true);
        // Inverter o status
        const newStatus = !book.isActive;
        // Atualizar o livro
        return this.bookService.updateBook(id, { isActive: newStatus }, admin.id, true);
    }

    @Patch(':id')
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
                publisher: { type: 'string' },
                publishedDate: { type: 'string' },
                printLength: { type: 'number' },
                isActive: { type: 'boolean' },
                readingAge: { type: 'string' },
                file: { type: 'string', format: 'binary' }
            }
        }
    })
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: './uploads/books',
            filename: (req, file, cb) => {
                const name = file.originalname.split('.')[0];
                const ext = path.extname(file.originalname);
                cb(null, `${name}_${Date.now()}${ext}`);
            }
        }),
        fileFilter: (req, file, cb) => {
            if (!file) {
                cb(null, true); // Permite sem arquivo
                return;
            }
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
        // 🪵 Início da depuração
        console.log(`\n--- 🚀 [PUT /admin/books/${id}] Endpoint Hit @ ${new Date().toLocaleTimeString()} ---`);
        console.log('1. ID do Livro (Param):', id, '| Tipo:', typeof id);
        console.log('2. Admin Autenticado (User):', { id: admin.id, name: admin.name, email: admin.email });
        console.log('3. DTO Recebido (Body):', updateBookDto);
        console.log('4. Arquivo Recebido (File):', file ? { filename: file.filename, mimetype: file.mimetype, size: file.size } : 'Nenhum arquivo enviado');

        // Buscar o livro atual
        const currentBook = await this.bookService.getBookById(id, admin.id, true);

        let downloadUrl: string | undefined = undefined;
        if (file) {
            downloadUrl = `/uploads/books/${file.filename}`;
            console.log('   - URL de download gerada:', downloadUrl);
        }

        // Filtrar campos vazios do DTO
        const filteredDto: any = {};
        Object.entries(updateBookDto).forEach(([key, value]) => {
            if (key === 'isbn') return; // ignora isbn
            if (value !== undefined && value !== null && value !== '') {
                filteredDto[key] = value;
            }
        });

        // Mesclar dados: se não veio no DTO (ou veio vazio), usa o valor atual
        const dataToUpdate = {
            title: filteredDto.title ?? currentBook.title,
            author: filteredDto.author ?? currentBook.author,
            price: filteredDto.price ?? currentBook.price,
            originalPrice: filteredDto.originalPrice ?? currentBook.originalPrice,
            rating: filteredDto.rating ?? currentBook.rating,
            reviewCount: filteredDto.reviewCount ?? currentBook.reviewCount,
            categoryId: filteredDto.categoryId ?? currentBook.categoryId,
            cover: filteredDto.cover ?? currentBook.cover,
            description: filteredDto.description ?? currentBook.description,
            sales: filteredDto.sales ?? currentBook.sales,
            language: filteredDto.language ?? currentBook.language,
            publisher: filteredDto.publisher ?? currentBook.publisher,
            publishedDate: filteredDto.publishedDate ?? currentBook.publishedDate,
            printLength: filteredDto.printLength ?? currentBook.printLength,
            isActive: filteredDto.isActive ?? currentBook.isActive,
            readingAge: filteredDto.readingAge ?? currentBook.readingAge,
            ...(downloadUrl ? { downloadUrl } : { downloadUrl: currentBook.downloadUrl })
        };

        console.log('5. Dados Finais para o Serviço:', dataToUpdate);

        try {
            const result = await this.bookService.updateBook(id, dataToUpdate, admin.id, true);
            console.log('6. ✅ Resultado do Serviço:', result);
            console.log('--- ✅ Endpoint Finalizado com Sucesso ---');
            return result;
        } catch (error) {
            console.error('7. ❌ ERRO no Serviço:', error);
            console.log('--- ❌ Endpoint Finalizado com Erro ---');
            throw error; // Re-lança o erro para o NestJS tratar
        }
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
