import { IsIn, IsInt, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class PrepareDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([137, 8453])
  chainId!: 137 | 8453;

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
  @ValidateIf((_, value) => typeof value === 'string')
  @IsString()
  @ValidateIf((_, value) => typeof value === 'number')
  @Type(() => Number)
  nonce?: string | number;

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
