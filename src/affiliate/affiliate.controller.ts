import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AffiliateService } from './affiliate.service';
import { AffiliateMeResponseDto, PaginatedAffiliateCommissionResponseDto, AffiliateQueryDto } from './dto/affiliate.dto';
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
}
