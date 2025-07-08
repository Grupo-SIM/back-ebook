import { ApiProperty } from '@nestjs/swagger';

export class Where {
    @ApiProperty({ name: 'skip', nullable: true, type: () => Number, required: false })
    skip?: number;

    @ApiProperty({ name: 'limit', nullable: true, type: () => Number, required: false })
    limit?: number;

    @ApiProperty({ name: 'search', nullable: true, type: () => String, required: false })
    search?: string;

    @ApiProperty({ name: 'leadIds', nullable: true, type: () => String, required: false })
    leadIds?: string;
}

export class WhereOnlyData {
    @ApiProperty({ name: 'startDate', nullable: true, type: () => Number, required: false })
    startDate?: number;

    @ApiProperty({ name: 'endDate', nullable: true, type: () => Number, required: false })
    endDate?: number;
}


export class WhereOnlyPagination {
    @ApiProperty({ name: 'skip', nullable: true, type: () => Number, required: false })
    skip?: number;

    @ApiProperty({ name: 'limit', nullable: true, type: () => Number, required: false })
    limit?: number;
}