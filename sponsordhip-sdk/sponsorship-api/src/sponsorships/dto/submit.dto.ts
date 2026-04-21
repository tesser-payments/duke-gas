import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([137, 8453])
  chainId!: 137 | 8453;

  @IsObject()
  @IsNotEmpty()
  signedUserOp!: {
    sender: string;
    nonce: string;
    callData: string;
    signature: string;

    callGasLimit?: string;
    verificationGasLimit?: string;
    preVerificationGas?: string;

    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;

    paymaster?: string;
    paymasterVerificationGasLimit?: string;
    paymasterPostOpGasLimit?: string;
    paymasterData?: string;

    factory?: string;
    factoryData?: string;
  };

  @IsOptional()
  @IsString()
  originalCallData?: string;
}
