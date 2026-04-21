import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ZeroDevService } from './zerodev.service';

@Controller('sponsorships')
export class SponsorshipsController {
  constructor(private readonly zeroDevService: ZeroDevService) {}

  @Post('prepare')
  async prepare(@Body() body: any) {
    try {
      return await this.zeroDevService.prepareUserOp({
        chainId: body.chainId,
        from: body.from,
        sender: body.sender,
        factory: body.factory,
        factoryData: body.factoryData,
        to: body.to,
        data: body.data,
        value: body.value,
        nonce: body.nonce,
        gasLimit: body.gasLimit,
        gasPrice: body.gasPrice,
        callData: body.callData,
        type: body.type,
      });
    } catch (error: any) {
      console.error('[prepare controller] failed:', error);

      throw new HttpException(
        {
          message: error?.message || 'prepare failed',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('submit')
  async submit(@Body() body: any) {
    try {
      return await this.zeroDevService.submitUserOp({
        chainId: body.chainId,
        signedUserOp: body.signedUserOp,
      });
    } catch (error: any) {
      console.error('[submit controller] failed:', error);

      throw new HttpException(
        {
          message: error?.message || 'submit failed',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
