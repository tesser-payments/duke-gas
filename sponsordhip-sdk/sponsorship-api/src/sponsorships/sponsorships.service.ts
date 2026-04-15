import { Injectable } from '@nestjs/common';
import { PrepareDto } from './dto/prepare.dto';
import { SubmitDto } from './dto/submit.dto';
import { ZeroDevService } from './zerodev.service';

@Injectable()
export class SponsorshipsService {
  constructor(private readonly zeroDevService: ZeroDevService) {}

  private serializeBigInt(data: any) {
    return JSON.parse(
      JSON.stringify(data, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }

  async prepare(body: PrepareDto) {
    const prepared = await this.zeroDevService.prepareUserOp(body);

    return this.serializeBigInt({
      message: 'prepare endpoint works',
      input: body,
      unsignedUserOp: prepared,
    });
  }

  async submit(body: SubmitDto) {
    return this.zeroDevService.submitUserOp(body.signedUserOp);
  }
}
