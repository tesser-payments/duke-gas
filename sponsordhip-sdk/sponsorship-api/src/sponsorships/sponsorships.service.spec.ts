import { Test, TestingModule } from '@nestjs/testing';
import { SponsorshipsService } from './sponsorships.service';

describe('SponsorshipsService', () => {
  let service: SponsorshipsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SponsorshipsService],
    }).compile();

    service = module.get<SponsorshipsService>(SponsorshipsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
