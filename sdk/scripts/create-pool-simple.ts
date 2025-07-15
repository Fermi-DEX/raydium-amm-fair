#!/usr/bin/env ts-node
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';

// Known Raydium devnet program IDs
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');
const SERUM_PROGRAM = new PublicKey('DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY');

async function main() {
    console.log('🚀 Creating Simple Raydium Pool on Devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load test wallet
    const walletPath = path.join(__dirname, '../test-wallet-devnet.json');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('💳 Wallet:', wallet.publicKey.toBase58());
    
    // Load test tokens
    const tokensPath = path.join(__dirname, '../test-tokens-devnet.json');
    const tokenInfo = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    
    const tokenAMint = new PublicKey(tokenInfo.toka.mint);
    const tokenBMint = new PublicKey(tokenInfo.tokb.mint);
    
    console.log('Token A:', tokenAMint.toBase58());
    console.log('Token B:', tokenBMint.toBase58());
    
    // For now, let's save a mock pool configuration that we can use for testing swaps
    // In production, you would create an actual pool using Raydium's createPoolV4
    
    // Generate deterministic pool addresses
    const poolId = PublicKey.findProgramAddressSync(
        [Buffer.from('pool'), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
        RAYDIUM_AMM_V4
    )[0];
    
    console.log('\n📊 Mock Pool Configuration:');
    console.log('Pool ID:', poolId.toBase58());
    console.log('Base Token:', tokenAMint.toBase58());
    console.log('Quote Token:', tokenBMint.toBase58());
    
    // Save pool configuration for testing
    const poolConfig = {
        poolId: poolId.toBase58(),
        baseMint: tokenAMint.toBase58(),
        quoteMint: tokenBMint.toBase58(),
        ammProgramId: RAYDIUM_AMM_V4.toBase58(),
        serumProgramId: SERUM_PROGRAM.toBase58(),
        tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
        mockPool: true,
        createdAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../pool-config-devnet.json'),
        JSON.stringify(poolConfig, null, 2)
    );
    
    console.log('\n💾 Pool configuration saved to pool-config-devnet.json');
    console.log('\n✅ Ready to test swapping through the Continuum wrapper!');
}

main().catch(console.error);