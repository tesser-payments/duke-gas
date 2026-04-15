import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class SubmitDto {
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
