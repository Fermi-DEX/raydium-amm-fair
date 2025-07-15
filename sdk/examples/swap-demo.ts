#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const WRAPPER_PROGRAM_ID = new PublicKey('9Mp8VkLRUR1Gw6HSXmByjM4tqabaDnoTpDpbzMvsiQ2Y');

async function main() {
    console.log('🚀 Continuum Wrapper Swap Demo...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load configurations
    const deploymentPath = path.join(__dirname, '../deployment-devnet.json');
    const tokensPath = path.join(__dirname, '../test-tokens-devnet.json');
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    
    // Load wallet
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Get accounts
    const fifoState = new PublicKey(deployment.fifoState);
    const userTokenA = new PublicKey(tokenInfo.toka.account);
    const userTokenB = new PublicKey(tokenInfo.tokb.account);
    
    // Check balances
    const tokenAAccount = await getAccount(connection, userTokenA);
    const tokenBAccount = await getAccount(connection, userTokenB);
    
    console.log('\n💰 Token Balances:');
    console.log('Token A:', Number(tokenAAccount.amount) / 10**9);
    console.log('Token B:', Number(tokenBAccount.amount) / 10**9);
    
    // Get current sequence
    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
        console.error('FIFO state not found!');
        return;
    }
    
    const currentSeq = fifoAccount.data.readBigUInt64LE(8);
    console.log('\n📊 FIFO Sequence:', currentSeq.toString());
    
    // Demonstrate the swap flow
    console.log('\n🔄 Swap Flow Through Continuum Wrapper:');
    console.log('\n1️⃣  Client prepares swap:');
    console.log('   - Amount: 100 Token A → Token B');
    console.log('   - Gets next sequence:', (currentSeq + BigInt(1)).toString());
    console.log('   - Derives delegate authority PDA');
    
    console.log('\n2️⃣  Transaction structure:');
    console.log('   a) Approve delegate to spend 100 Token A');
    console.log('   b) Call wrapper.swapWithSeq with:');
    console.log('      - Sequence number');
    console.log('      - Raydium swap instruction data');
    console.log('      - All required accounts');
    
    console.log('\n3️⃣  Wrapper execution:');
    console.log('   a) Verifies sequence = expected');
    console.log('   b) CPI to Raydium with delegate as signer');
    console.log('   c) Immediately revokes delegation');
    console.log('   d) Increments global sequence');
    
    console.log('\n4️⃣  Result:');
    console.log('   - Swap executed in FIFO order');
    console.log('   - No sandwich attacks possible');
    console.log('   - Delegation auto-revoked');
    
    console.log('\n✅ Demo complete!');
    console.log('\n📚 Key Security Features:');
    console.log('- Global sequence enforcement prevents reordering');
    console.log('- Temporary delegation minimizes risk exposure');
    console.log('- PDA signing prevents key compromise');
    console.log('- Immediate revocation after each swap');
    
    // Save demo summary
    const demoSummary = {
        wrapperProgram: WRAPPER_PROGRAM_ID.toBase58(),
        fifoState: fifoState.toBase58(),
        currentSequence: currentSeq.toString(),
        wallet: wallet.publicKey.toBase58(),
        tokenA: {
            account: userTokenA.toBase58(),
            balance: Number(tokenAAccount.amount) / 10**9
        },
        tokenB: {
            account: userTokenB.toBase58(),
            balance: Number(tokenBAccount.amount) / 10**9
        },
        timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../demo-summary-devnet.json'),
        JSON.stringify(demoSummary, null, 2)
    );
    
    console.log('\n💾 Demo summary saved to demo-summary-devnet.json');
}

main().catch(console.error);