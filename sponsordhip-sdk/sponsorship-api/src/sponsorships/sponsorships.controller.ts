import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SponsorshipsService } from './sponsorships.service';
import { PrepareDto } from './dto/prepare.dto';
import { SubmitDto } from './dto/submit.dto';
import { ApiKeyGuard } from '../common/api-key.guard';

@Controller('sponsorships')
@UseGuards(ApiKeyGuard)
export class SponsorshipsController {
  constructor(private readonly sponsorshipsService: SponsorshipsService) {}

  @Post('prepare')
  async prepare(@Body() body: PrepareDto) {
    return this.sponsorshipsService.prepare(body);
  }

  @Post('submit')
  async submit(@Body() body: SubmitDto) {
    return this.sponsorshipsService.submit(body);
  }
}
