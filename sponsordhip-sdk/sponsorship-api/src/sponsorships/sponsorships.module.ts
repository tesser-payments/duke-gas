import { Module } from '@nestjs/common';
import { SponsorshipsController } from './sponsorships.controller';
import { SponsorshipsService } from './sponsorships.service';
import { ZeroDevService } from './zerodev.service';

@Module({
  controllers: [SponsorshipsController],
  providers: [SponsorshipsService, ZeroDevService],
})
export class SponsorshipsModule {}
