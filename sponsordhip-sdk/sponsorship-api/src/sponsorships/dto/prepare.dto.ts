export class PrepareDto {
  from!: string;
  to?: string;
  data?: `0x${string}`;
  value?: string;
  nonce?: number;

  gasLimit?: string;
  gasPrice?: string;

  type?: 'verifying' | 'erc20';
}
