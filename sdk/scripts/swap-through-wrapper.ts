#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { 
  getAccount,
  createApproveCheckedInstruction,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');

// Raydium swap instruction discriminator
const RAYDIUM_SWAP_DISCRIMINATOR = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);

async function main() {
    console.log('🚀 Testing Swap Through Continuum Wrapper...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load configurations
    const deploymentPath = path.join(__dirname, '../deployment-devnet.json');
    const poolConfigPath = path.join(__dirname, '../pool-config-devnet.json');
    const tokensPath = path.join(__dirname, '../test-tokens-devnet.json');
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const poolConfig = JSON.parse(fs.readFileSync(poolConfigPath, 'utf8'));
    const tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Get accounts
    const fifoState = new PublicKey(deployment.fifoState);
    const tokenAMint = new PublicKey(tokenInfo.toka.mint);
    const tokenBMint = new PublicKey(tokenInfo.tokb.mint);
    const userTokenA = new PublicKey(tokenInfo.toka.account);
    const userTokenB = new PublicKey(tokenInfo.tokb.account);
    
    // Check balances
    const tokenAAccount = await getAccount(connection, userTokenA);
    const tokenBAccount = await getAccount(connection, userTokenB);
    
    console.log('\n💰 Initial Balances:');
    console.log('Token A:', Number(tokenAAccount.amount) / 10**9);
    console.log('Token B:', Number(tokenBAccount.amount) / 10**9);
    
    // Get current sequence
    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
        console.error('FIFO state not found!');
        return;
    }
    
    const currentSeq = fifoAccount.data.readBigUInt64LE(8);
    const nextSeq = currentSeq + BigInt(1);
    console.log('\n📊 Current sequence:', currentSeq.toString());
    console.log('📊 Next sequence:', nextSeq.toString());
    
    // Swap parameters
    const amountIn = new BN(100).mul(new BN(10).pow(new BN(9))); // 100 Token A
    const minAmountOut = new BN(90).mul(new BN(10).pow(new BN(9))); // 90 Token B (10% slippage)
    
    console.log('\n💱 Swap Parameters:');
    console.log('Amount In:', amountIn.div(new BN(10).pow(new BN(9))).toString(), 'Token A');
    console.log('Min Amount Out:', minAmountOut.div(new BN(10).pow(new BN(9))).toString(), 'Token B');
    
    // Get delegate authority PDA
    const [delegateAuthority, delegateBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegate"), userTokenA.toBuffer()],
        WRAPPER_PROGRAM_ID
    );
    
    console.log('\n🔐 Delegate Authority:', delegateAuthority.toBase58());
    console.log('Bump:', delegateBump);
    
    // Build transaction
    const tx = new Transaction();
    
    // Add compute budget
    tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })
    );
    
    // 1. Approve delegate
    const approveIx = createApproveCheckedInstruction(
        userTokenA,
        tokenAMint,
        delegateAuthority,
        wallet.publicKey,
        amountIn.toNumber(),
        9 // decimals
    );
    tx.add(approveIx);
    
    // 2. Build Raydium swap instruction data
    const raydiumIxData = Buffer.concat([
        RAYDIUM_SWAP_DISCRIMINATOR,
        amountIn.toArrayLike(Buffer, 'le', 8),
        minAmountOut.toArrayLike(Buffer, 'le', 8)
    ]);
    
    // 3. Build wrapper instruction
    // Discriminator for swapWithSeq: [59, 244, 195, 210, 250, 208, 38, 108]
    const wrapperDiscriminator = Buffer.from([59, 244, 195, 210, 250, 208, 38, 108]);
    
    // Serialize wrapper instruction data
    const seqBuffer = Buffer.alloc(8);
    seqBuffer.writeBigUInt64LE(nextSeq);
    
    const raydiumDataLen = Buffer.alloc(4);
    raydiumDataLen.writeUInt32LE(raydiumIxData.length);
    
    const wrapperIxData = Buffer.concat([
        wrapperDiscriminator,
        seqBuffer,
        raydiumDataLen,
        raydiumIxData
    ]);
    
    // For this example, we'll create a simplified swap instruction
    // In production, you would need all the correct Raydium pool accounts
    const wrapperIx = new TransactionInstruction({
        programId: WRAPPER_PROGRAM_ID,
        keys: [
            // Wrapper-specific accounts
            { pubkey: fifoState, isSigner: false, isWritable: true },
            { pubkey: delegateAuthority, isSigner: false, isWritable: false },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
            { pubkey: userTokenA, isSigner: false, isWritable: true },
            { pubkey: userTokenB, isSigner: false, isWritable: true },
            { pubkey: RAYDIUM_AMM_V4, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            
            // Raydium accounts would go here as remaining_accounts
            // For demo purposes, we're showing the structure
        ],
        data: wrapperIxData
    });
    
    tx.add(wrapperIx);
    
    console.log('\n📝 Transaction built with:');
    console.log('- Compute budget: 400,000 units');
    console.log('- Approve instruction for delegate');
    console.log('- Wrapper swap instruction with sequence', nextSeq.toString());
    
    // In a real implementation, you would send the transaction
    console.log('\n✅ Wrapper swap transaction ready!');
    console.log('\n⚠️  Note: This is a demo transaction structure.');
    console.log('For production use, you need:');
    console.log('1. All Raydium pool accounts (vaults, authority, etc.)');
    console.log('2. Proper market accounts from Serum/OpenBook');
    console.log('3. Correct account ordering as expected by Raydium');
    
    // Save example transaction structure
    const txExample = {
        fifoState: fifoState.toBase58(),
        delegateAuthority: delegateAuthority.toBase58(),
        sequence: nextSeq.toString(),
        amountIn: amountIn.toString(),
        minAmountOut: minAmountOut.toString(),
        userTokenA: userTokenA.toBase58(),
        userTokenB: userTokenB.toBase58(),
        wrapperProgram: WRAPPER_PROGRAM_ID.toBase58(),
        raydiumProgram: RAYDIUM_AMM_V4.toBase58(),
        timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../swap-example-devnet.json'),
        JSON.stringify(txExample, null, 2)
    );
    
    console.log('\n💾 Transaction example saved to swap-example-devnet.json');
}

main().catch(console.error);