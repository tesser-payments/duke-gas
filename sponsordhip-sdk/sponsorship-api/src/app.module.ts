import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SponsorshipsModule } from './sponsorships/sponsorships.module';

@Module({
  imports: [SponsorshipsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
