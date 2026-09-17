import { Controller, Get, Post, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AffiliateService } from './affiliate.service';
import {
    AffiliateMeResponseDto,
    PaginatedAffiliateCommissionResponseDto,
    AffiliateQueryDto,
    AffiliateMarketplaceQueryDto,
    PaginatedAffiliateMarketplaceBookResponseDto,
    AffiliateProductLinkResponseDto,
} from './dto/affiliate.dto';
import { JwtAuthGuardAdmin } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';

@ApiTags('Affiliate')
@Controller('affiliate')
@UseGuards(JwtAuthGuardAdmin)
@ApiBearerAuth()
export class AffiliateController {
    constructor(private readonly affiliateService: AffiliateService) { }

    @Get('me')
    @ApiOperation({ summary: 'Obter código, link e resumo de comissões do afiliado autenticado' })
    @ApiResponse({ status: 200, type: AffiliateMeResponseDto })
    async getMe(@GetUser() admin: RequestWithUser['user']): Promise<AffiliateMeResponseDto> {
        return this.affiliateService.getMe(admin.id);
    }

    @Get('commissions')
    @ApiOperation({ summary: 'Listar comissões de afiliado do admin autenticado' })
    @ApiResponse({ status: 200, type: PaginatedAffiliateCommissionResponseDto })
    async getCommissions(
        @Query() query: AffiliateQueryDto,
        @GetUser() admin: RequestWithUser['user'],
    ): Promise<PaginatedAffiliateCommissionResponseDto> {
        return this.affiliateService.getMyCommissions(admin.id, query);
    }

    @Get('marketplace/categories')
    @ApiOperation({ summary: 'Listar categorias distintas dos livros disponíveis para afiliação' })
    @ApiResponse({ status: 200, type: [String] })
    async getMarketplaceCategories(@GetUser() admin: RequestWithUser['user']): Promise<string[]> {
        return this.affiliateService.getMarketplaceCategories(admin.id);
    }

    @Get('marketplace')
    @ApiOperation({ summary: 'Listar livros de outros admins disponíveis para afiliação' })
    @ApiResponse({ status: 200, type: PaginatedAffiliateMarketplaceBookResponseDto })
    async getMarketplace(
        @Query() query: AffiliateMarketplaceQueryDto,
        @GetUser() admin: RequestWithUser['user'],
    ): Promise<PaginatedAffiliateMarketplaceBookResponseDto> {
        return this.affiliateService.getMarketplaceBooks(admin.id, query);
    }

    @Post('marketplace/:bookId/link')
    @ApiOperation({ summary: 'Gerar (ou obter) o link único de afiliado do admin autenticado para um livro' })
    @ApiResponse({ status: 200, type: AffiliateProductLinkResponseDto })
    async createProductLink(
        @Param('bookId', ParseIntPipe) bookId: number,
        @GetUser() admin: RequestWithUser['user'],
    ): Promise<AffiliateProductLinkResponseDto> {
        return this.affiliateService.ensureProductLink(admin.id, bookId);
    }
}
