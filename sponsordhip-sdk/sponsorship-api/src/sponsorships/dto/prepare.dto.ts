import { IsIn, IsOptional, IsString } from 'class-validator';

export class PrepareDto {
  @IsString()
  from!: string;

  @IsString()
  sender!: string;

  @IsOptional()
  @IsString()
  factory?: string;

  @IsOptional()
  @IsString()
  factoryData?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  data?: `0x${string}`;

  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsString()
  callData?: `0x${string}`;

  @IsOptional()
  nonce?: number;

  @IsOptional()
  @IsString()
  gasLimit?: string;

  @IsOptional()
  @IsString()
  gasPrice?: string;

  @IsOptional()
  @IsIn(['verifying', 'erc20'])
  type?: 'verifying' | 'erc20';
}
