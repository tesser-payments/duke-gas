import { Test, TestingModule } from '@nestjs/testing';
import { SponsorshipsController } from './sponsorships.controller';

describe('SponsorshipsController', () => {
  let controller: SponsorshipsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SponsorshipsController],
    }).compile();

    controller = module.get<SponsorshipsController>(SponsorshipsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
