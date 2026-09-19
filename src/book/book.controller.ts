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
    Res,
    HttpStatus,
    NotFoundException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiParam,
    ApiQuery,
    ApiBearerAuth,
    ApiConsumes,
    ApiBody,
} from '@nestjs/swagger';
import { BookService } from './book.service';
import { CreateBookDto, UpdateBookDto, BookResponseDto, BookQueryDto, PaginatedBookResponseDto, CreateReviewDto, ReviewResponseDto, PaginatedReviewsResponseDto } from './dto/book.dto';
import { JwtAuthGuardAll, JwtAuthGuardAdmin } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { Response } from 'express';
import * as fs from 'fs';
import { uploadFileS3, getUrlImageByKey } from 'src/common/storj';

@Controller('books')
@ApiTags('Books')
export class BookController {
    constructor(private readonly bookService: BookService) { }

    @Post()
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
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
                isFree: { type: 'boolean', description: 'Calculado automaticamente a partir do preço' },
                readingAge: { type: 'string' },
                file: { type: 'string', format: 'binary' }
            }
        }
    })
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: './tmp',
            filename: (req, file, cb) => {
                const randomName = Array(32)
                    .fill(null)
                    .map(() => Math.round(Math.random() * 16).toString(16))
                    .join('');
                cb(null, `${randomName}${path.extname(file.originalname)}`);
            }
        }),
        fileFilter: (req, file, cb) => {
            const allowed = ['.pdf', '.epub', '.mobi'];
            const ext = path.extname(file.originalname).toLowerCase();
            if (allowed.includes(ext)) cb(null, true);
            else cb(new Error('Only PDF, EPUB, MOBI allowed'), false);
        },
        limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit para PDFs
    }))
    async createBook(
        @Body() createBookDto: CreateBookDto,
        @GetUser() user: RequestWithUser['user'],
        @UploadedFile() file?: Express.Multer.File
    ): Promise<BookResponseDto> {
        let downloadUrl: string | undefined = undefined;
        
        // Se um arquivo PDF foi enviado, fazer upload para o Storj S3
        if (file) {
            try {
                console.log('📚 Fazendo upload do PDF para Storj...', {
                    originalName: file.originalname,
                    size: file.size,
                    mimetype: file.mimetype
                });
                
                const pdfKey = await uploadFileS3(file);
                downloadUrl = getUrlImageByKey(pdfKey);
                
                console.log('✅ Upload do PDF concluído:', downloadUrl);
            } catch (error) {
                console.error('❌ Erro ao fazer upload do PDF:', error);
                throw error;
            }
        }
        
        return this.bookService.createBook({ ...createBookDto, downloadUrl }, user.id);
    }

    @Get()
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
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar todos os livros sem filtros (debug)' })
    async getAllBooksDebug() {
        return this.bookService.getAllBooksDebug();
    }

    @Get('debug/all-without-filters')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar todos os livros sem filtros (incluindo inativos)' })
    async getAllBooksWithoutFilters() {
        return this.bookService.getAllBooksWithoutFilters();
    }

    @Get('top-selling')
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
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar livros gratuitos' })
    async getFreeBooks(
        @Query() query: BookQueryDto,
        @GetUser() user?: RequestWithUser['user'],
    ) {
        return this.bookService.getAllBooks({ ...query, type: 'free' }, user?.id);
    }

    @Get('paid')
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

    @Get(':bookId/reviews')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar reviews de um livro' })
    async getReviews(
        @Param('bookId', ParseIntPipe) bookId: number,
        @Query('page') page = 1,
        @Query('limit') limit = 10,
    ): Promise<PaginatedReviewsResponseDto> {
        return this.bookService.getReviews(bookId, Number(page), Number(limit));
    }

    @Get(':bookId/reviews/stats')
    @ApiOperation({ summary: 'Obter estatísticas de reviews do livro (quantidade por estrela e média)' })
    @ApiResponse({ status: 200, description: 'Estatísticas de reviews', schema: { example: { quantity1: 4, quantity2: 3, quantity3: 14, quantity4: 30, quantity5: 1500, average: 4.5 } } })
    async getReviewStats(@Param('bookId', ParseIntPipe) bookId: number) {
        return this.bookService.getReviewStats(bookId);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
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
                file: { type: 'string', format: 'binary' }
            }
        }
    })
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: './tmp',
            filename: (req, file, cb) => {
                const randomName = Array(32)
                    .fill(null)
                    .map(() => Math.round(Math.random() * 16).toString(16))
                    .join('');
                cb(null, `${randomName}${path.extname(file.originalname)}`);
            }
        }),
        fileFilter: (req, file, cb) => {
            const allowed = ['.pdf', '.epub', '.mobi'];
            const ext = path.extname(file.originalname).toLowerCase();
            if (allowed.includes(ext)) cb(null, true);
            else cb(new Error('Only PDF, EPUB, MOBI allowed'), false);
        },
        limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit para PDFs
    }))
    async updateBook(
        @Param('id') id: string,
        @Body() updateBookDto: UpdateBookDto,
        @UploadedFile() file?: Express.Multer.File
    ): Promise<BookResponseDto> {
        let downloadUrl: string | undefined = undefined;
        
        // Se um arquivo PDF foi enviado, fazer upload para o Storj S3
        if (file) {
            try {
                console.log('📚 Fazendo upload do PDF para Storj (update)...', {
                    originalName: file.originalname,
                    size: file.size,
                    mimetype: file.mimetype
                });
                
                const pdfKey = await uploadFileS3(file);
                downloadUrl = getUrlImageByKey(pdfKey);
                
                console.log('✅ Upload do PDF concluído:', downloadUrl);
            } catch (error) {
                console.error('❌ Erro ao fazer upload do PDF:', error);
                throw error;
            }
        }
        
        return this.bookService.updateBook(Number(id), { ...updateBookDto, ...(downloadUrl ? { downloadUrl } : {}) });
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

    @Put(':bookId/reviews')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Editar review do usuário autenticado para um livro' })
    @ApiResponse({ status: 200, description: 'Review atualizado', type: ReviewResponseDto })
    async updateReview(
        @Param('bookId', ParseIntPipe) bookId: number,
        @Body() dto: CreateReviewDto,
        @GetUser() user: RequestWithUser['user'],
    ): Promise<ReviewResponseDto> {
        return this.bookService.createReview(bookId, user.id, dto);
    }

    @Get(':id/download')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Download do arquivo do livro (protegido)' })
    async downloadBookFile(
        @Param('id') id: string,
        @GetUser() user: RequestWithUser['user'],
        @Res() res: Response
    ) {
        console.log(`🔍 Download solicitado - Livro ID: ${id}, Usuário: ${user.id}`);
        
        const book = await this.bookService.getBookById(Number(id), user?.id);
        console.log(`📚 Livro encontrado: ${book.title}, Download URL: ${book.downloadUrl}`);
        
        if (!book.downloadUrl) {
            console.log(`❌ Download URL não encontrada para o livro ${id}`);
            return res.status(HttpStatus.NOT_FOUND).json({ message: 'Arquivo não encontrado' });
        }
        
        // Se for pago, só quem comprou pode baixar
        if (!book.isFree) {
            console.log(`💰 Livro pago - verificando se usuário comprou`);
            const purchased = await this.bookService.userHasPurchasedBook(Number(id), user.id);
            console.log(`✅ Usuário comprou o livro: ${purchased}`);
            
            if (!purchased) {
                console.log(`❌ Usuário não tem permissão para baixar o livro ${id}`);
                return res.status(HttpStatus.FORBIDDEN).json({ message: 'Você não tem permissão para baixar este livro.' });
            }
        } else {
            console.log(`🆓 Livro gratuito - download permitido`);
        }
        
        // ✅ Verificar se é URL do Storj (começa com http/https)
        if (book.downloadUrl.startsWith('http://') || book.downloadUrl.startsWith('https://')) {
            console.log(`☁️ Arquivo está no Storj - redirecionando para: ${book.downloadUrl}`);
            
            // Redirecionar para a URL do Storj (o navegador vai baixar diretamente)
            return res.redirect(book.downloadUrl);
        }
        
        // 💾 Se for caminho local (livros antigos), manter lógica de disco
        console.log(`💾 Arquivo no disco local - buscando arquivo físico`);
        let filePath: string;
        
        // Corrigir a lógica de construção do caminho
        if (book.downloadUrl.startsWith('/uploads/')) {
            // Se começa com /uploads/, remover a barra inicial e usar process.cwd()
            filePath = path.join(process.cwd(), book.downloadUrl.substring(1));
        } else if (book.downloadUrl.startsWith('uploads/')) {
            // Se começa com uploads/ (sem barra), usar process.cwd() diretamente
            filePath = path.join(process.cwd(), book.downloadUrl);
        } else {
            // Se não tem prefixo, adicionar uploads/
            filePath = path.join(process.cwd(), 'uploads', book.downloadUrl);
        }
        
        console.log(`📁 Caminho do arquivo: ${filePath}`);
        console.log(`📁 Diretório de trabalho: ${process.cwd()}`);
        console.log(`📁 Download URL do livro: ${book.downloadUrl}`);
        
        // Verificar se o arquivo existe
        if (!fs.existsSync(filePath)) {
            console.log(`❌ Arquivo não encontrado no caminho: ${filePath}`);
            
            // Tentar caminhos alternativos para debug
            const alternativePaths = [
                path.join(process.cwd(), 'uploads', 'books', path.basename(book.downloadUrl)),
                path.join(process.cwd(), book.downloadUrl),
                path.join(process.cwd(), 'uploads', path.basename(book.downloadUrl))
            ];
            
            console.log(`🔍 Tentando caminhos alternativos:`);
            alternativePaths.forEach(altPath => {
                console.log(`  - ${altPath}: ${fs.existsSync(altPath) ? '✅ Existe' : '❌ Não existe'}`);
            });
            
            return res.status(HttpStatus.NOT_FOUND).json({ message: 'Arquivo físico não encontrado no servidor' });
        }
        
        console.log(`✅ Iniciando download do arquivo: ${book.title}`);
        return res.download(filePath);
    }

    @Get(':id/purchase-status')
    @UseGuards(JwtAuthGuardAll)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Verificar status de compra do livro (protegido)' })
    @ApiParam({ name: 'id', description: 'ID do livro' })
    @ApiResponse({ status: 200, description: 'Status de compra retornado com sucesso' })
    @ApiResponse({ status: 404, description: 'Livro não encontrado' })
    async getPurchaseStatus(
        @Param('id') id: string,
        @GetUser() user: RequestWithUser['user']
    ) {
        console.log(`🔍 Purchase status solicitado - Livro ID: ${id}, Usuário: ${user.id}`);
        
        const book = await this.bookService.getBookById(Number(id), user?.id);
        if (!book) {
            console.log(`❌ Livro não encontrado: ${id}`);
            throw new NotFoundException('Livro não encontrado');
        }

        console.log(`📚 Livro encontrado: ${book.title}, Preço: ${book.price}, Gratuito: ${book.isFree}`);
        
        const hasPurchased = await this.bookService.userHasPurchasedBook(Number(id), user.id);
        console.log(`✅ Usuário comprou o livro: ${hasPurchased}`);
        
        const response = {
            bookId: Number(id),
            title: book.title,
            isFree: book.isFree,
            hasPurchased,
            canDownload: book.isFree || hasPurchased,
            downloadUrl: hasPurchased || book.isFree ? book.downloadUrl : null,
            message: hasPurchased 
                ? 'Você comprou este livro e pode fazer o download.'
                : book.isFree 
                    ? 'Este livro é gratuito e você pode fazer o download.'
                    : 'Você precisa comprar este livro para fazer o download.'
        };
        
        console.log(`📋 Resposta do purchase status:`, response);
        return response;
    }

    @Get('debug/files/:bookId')
    @UseGuards(JwtAuthGuardAdmin)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Debug: Verificar arquivos de um livro (apenas ADMIN)' })
    async debugBookFiles(@Param('bookId') bookId: string) {
        const book = await this.bookService.getBookById(Number(bookId));
        if (!book) {
            throw new NotFoundException('Livro não encontrado');
        }

        const uploadsDir = path.join(process.cwd(), 'uploads');
        const booksDir = path.join(uploadsDir, 'books');
        
        // Verificar estrutura de diretórios
        const dirsExist = {
            uploads: fs.existsSync(uploadsDir),
            books: fs.existsSync(booksDir)
        };
        
        // Listar arquivos no diretório books
        let filesInBooks = [];
        if (dirsExist.books) {
            try {
                filesInBooks = fs.readdirSync(booksDir);
            } catch (error) {
                filesInBooks = [`Erro ao ler diretório: ${error.message}`];
            }
        }
        
        // Verificar caminhos específicos do livro
        const possiblePaths = [
            path.join(process.cwd(), book.downloadUrl || ''),
            path.join(process.cwd(), 'uploads', book.downloadUrl || ''),
            path.join(process.cwd(), 'uploads', 'books', path.basename(book.downloadUrl || '')),
            path.join(process.cwd(), 'uploads', path.basename(book.downloadUrl || ''))
        ];
        
        const pathChecks = possiblePaths.map(p => ({
            path: p,
            exists: fs.existsSync(p),
            isFile: fs.existsSync(p) ? fs.statSync(p).isFile() : false,
            size: fs.existsSync(p) ? fs.statSync(p).size : 0
        }));
        
        return {
            book: {
                id: book.id,
                title: book.title,
                downloadUrl: book.downloadUrl
            },
            directories: {
                currentWorkingDir: process.cwd(),
                uploadsDir,
                booksDir,
                ...dirsExist
            },
            filesInBooksDir: filesInBooks,
            pathChecks,
            recommendations: {
                correctPath: book.downloadUrl?.startsWith('/uploads/') 
                    ? path.join(process.cwd(), book.downloadUrl.substring(1))
                    : book.downloadUrl?.startsWith('uploads/')
                    ? path.join(process.cwd(), book.downloadUrl)
                    : path.join(process.cwd(), 'uploads', book.downloadUrl || '')
            }
        };
    }
} 
