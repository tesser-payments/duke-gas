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
  private readonly POLYGON_ERC20_PAYMASTER = process.env
    .POLYGON_ERC20_PAYMASTER as `0x${string}` | undefined;

  async prepare(body: PrepareDto) {
    const prepared = await this.zeroDevService.prepareUserOp({
      chainId: body.chainId,
      from: body.from,
      sender: body.sender,
      factory: body.factory as `0x${string}` | undefined,
      factoryData: body.factoryData as `0x${string}` | undefined,
      to: body.to as `0x${string}` | undefined,
      data: body.data,
      value: body.value,
      nonce: body.nonce,
      gasLimit: body.gasLimit,
      gasPrice: body.gasPrice,
      callData: body.callData,
      type: body.type,
    });

    return this.serializeBigInt({
      message: 'prepare endpoint works',
      input: body,
      unsignedUserOp: prepared,
    });
  }

  async submit(body: SubmitDto) {
    return this.zeroDevService.submitUserOp({
      chainId: body.chainId,
      signedUserOp: body.signedUserOp,
    });
  }
}
