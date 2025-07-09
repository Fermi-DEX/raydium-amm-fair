import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

export interface SwapParams {
  user: Keypair;
  userSource: PublicKey;
  userDestination: PublicKey;
  amountIn: BN;
  minimumAmountOut: BN;
  poolId: PublicKey;
  
  // Raydium-specific accounts
  ammAuthority: PublicKey;
  openOrders: PublicKey;
  targetOrders: PublicKey;
  poolCoinTokenAccount: PublicKey;
  poolPcTokenAccount: PublicKey;
  serumProgram: PublicKey;
  serumMarket: PublicKey;
  serumBids: PublicKey;
  serumAsks: PublicKey;
  serumEventQueue: PublicKey;
  serumCoinVaultAccount: PublicKey;
  serumPcVaultAccount: PublicKey;
  serumVaultSigner: PublicKey;
  coinMint: PublicKey;
  pcMint: PublicKey;
}

export interface ContinuumConfig {
  connection: Connection;
  wrapperProgramId: PublicKey;
  raydiumProgramId: PublicKey;
}

export interface FifoState {
  seq: BN;
}

export interface SeqEvent {
  seq: BN;
  user: PublicKey;
}