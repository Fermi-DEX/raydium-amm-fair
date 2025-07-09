import { 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  getAssociatedTokenAddress
} from '@solana/spl-token';
import { Program, BN } from '@coral-xyz/anchor';
import { SwapParams, ContinuumConfig } from '../types';
import { SequenceManager } from './SequenceManager';
import { accountMeta } from '../utils/helpers';

export class ContinuumTransactionBuilder {
  private program: Program<any>;
  private sequenceManager: SequenceManager;
  private config: ContinuumConfig;

  constructor(program: Program<any>, sequenceManager: SequenceManager, config: ContinuumConfig) {
    this.program = program;
    this.sequenceManager = sequenceManager;
    this.config = config;
  }

  async buildSwapTransaction(params: SwapParams): Promise<Transaction> {
    const tx = new Transaction();
    
    // Get PDAs
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from("fifo_state")],
      this.config.wrapperProgramId
    );
    
    const [delegateAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegate"), params.userSource.toBuffer()],
      this.config.wrapperProgramId
    );

    // Step 1: Approve delegation to PDA
    const approveIx = createApproveInstruction(
      params.userSource,
      delegateAuthority,
      params.user.publicKey,
      params.amountIn.toNumber()
    );
    tx.add(approveIx);

    // Step 2: Build wrapper instruction
    const wrapperIx = await this.buildWrapperInstruction(params, fifoState, delegateAuthority);
    tx.add(wrapperIx);

    return tx;
  }

  private async buildWrapperInstruction(
    params: SwapParams,
    fifoState: PublicKey,
    delegateAuthority: PublicKey
  ): Promise<TransactionInstruction> {
    // Get next sequence
    const nextSeq = await this.sequenceManager.getNextSequence(fifoState);
    
    // Build Raydium swap instruction data
    const raydiumIxData = this.serializeRaydiumSwapData(params);
    
    // Build account list for wrapper
    const keys = [
      // Wrapper-specific accounts
      accountMeta({ pubkey: fifoState, isMut: true }),
      accountMeta({ pubkey: delegateAuthority, isMut: true }),
      accountMeta({ pubkey: params.user.publicKey, isSigner: true }),
      accountMeta({ pubkey: params.userSource, isMut: true }),
      accountMeta({ pubkey: params.userDestination, isMut: true }),
      accountMeta({ pubkey: this.config.raydiumProgramId }),
      accountMeta({ pubkey: TOKEN_PROGRAM_ID }),
      
      // Raydium accounts (in exact order expected by Raydium)
      ...this.getRaydiumAccounts(params)
    ];

    // Encode instruction data: seq (u64) + raydium_ix_data (bytes)
    const data = Buffer.concat([
      nextSeq.toArrayLike(Buffer, 'le', 8),
      Buffer.from(raydiumIxData)
    ]);

    return new TransactionInstruction({
      programId: this.config.wrapperProgramId,
      keys,
      data
    });
  }

  private serializeRaydiumSwapData(params: SwapParams): Buffer {
    // Raydium swap instruction 9 (fixed in)
    const instructionId = 9;
    
    // Layout: u8 (instruction) + u64 (amountIn) + u64 (minAmountOut)
    const data = Buffer.alloc(1 + 8 + 8);
    let offset = 0;
    
    // Write instruction ID
    data.writeUInt8(instructionId, offset);
    offset += 1;
    
    // Write amountIn (little-endian)
    const amountInBuffer = params.amountIn.toArrayLike(Buffer, 'le', 8);
    amountInBuffer.copy(data, offset);
    offset += 8;
    
    // Write minimumAmountOut (little-endian)
    const minAmountOutBuffer = params.minimumAmountOut.toArrayLike(Buffer, 'le', 8);
    minAmountOutBuffer.copy(data, offset);
    
    return data;
  }

  private getRaydiumAccounts(params: SwapParams): any[] {
    // Build Raydium account metas in the exact order expected
    // Note: The delegate authority should be passed where user authority is expected
    const [delegateAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegate"), params.userSource.toBuffer()],
      this.config.wrapperProgramId
    );

    return [
      // Token program
      accountMeta({ pubkey: TOKEN_PROGRAM_ID }),
      
      // AMM accounts
      accountMeta({ pubkey: params.poolId, isMut: true }),
      accountMeta({ pubkey: params.ammAuthority }),
      accountMeta({ pubkey: params.openOrders, isMut: true }),
      accountMeta({ pubkey: params.targetOrders, isMut: true }),
      accountMeta({ pubkey: params.poolCoinTokenAccount, isMut: true }),
      accountMeta({ pubkey: params.poolPcTokenAccount, isMut: true }),
      
      // Serum market accounts
      accountMeta({ pubkey: params.serumProgram }),
      accountMeta({ pubkey: params.serumMarket, isMut: true }),
      accountMeta({ pubkey: params.serumBids, isMut: true }),
      accountMeta({ pubkey: params.serumAsks, isMut: true }),
      accountMeta({ pubkey: params.serumEventQueue, isMut: true }),
      accountMeta({ pubkey: params.serumCoinVaultAccount, isMut: true }),
      accountMeta({ pubkey: params.serumPcVaultAccount, isMut: true }),
      accountMeta({ pubkey: params.serumVaultSigner }),
      
      // User accounts (with delegate authority instead of user)
      accountMeta({ pubkey: params.userSource, isMut: true }),
      accountMeta({ pubkey: params.userDestination, isMut: true }),
      accountMeta({ pubkey: delegateAuthority, isSigner: true }) // Delegate as signer
    ];
  }

  async buildInitializeFifoStateTransaction(): Promise<Transaction> {
    const tx = new Transaction();
    
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from("fifo_state")],
      this.config.wrapperProgramId
    );

    // Check if already initialized
    try {
      await (this.program.account as any).fifoState.fetch(fifoState);
      console.log("FifoState already initialized");
      return tx; // Return empty transaction
    } catch (e) {
      // Account doesn't exist, proceed with initialization
    }

    const initIx = await (this.program.methods as any)
      .initialize()
      .accounts({
        fifoState,
        payer: (this.program.provider as any).wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    tx.add(initIx);
    return tx;
  }
}