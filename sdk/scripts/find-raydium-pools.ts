#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');

// Known devnet test pools (if any exist)
const KNOWN_POOLS = [
    // RAY-USDC pool on devnet
    'EVzLJhqMtdC1nPmz8rNd6xGfVjDPxpLZgq7XJuNfMZ6',
    // Add more known pools here
];

async function main() {
    console.log('🔍 Finding Raydium Pools on Devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Check known pools
    for (const poolId of KNOWN_POOLS) {
        try {
            const poolPubkey = new PublicKey(poolId);
            const poolAccount = await connection.getAccountInfo(poolPubkey);
            
            if (poolAccount) {
                console.log(`✅ Found pool: ${poolId}`);
                console.log(`   Owner: ${poolAccount.owner.toBase58()}`);
                console.log(`   Data length: ${poolAccount.data.length}`);
            } else {
                console.log(`❌ Pool not found: ${poolId}`);
            }
        } catch (e) {
            console.log(`❌ Invalid pool ID: ${poolId}`);
        }
    }
    
    // For testing, let's use a simple approach with known tokens
    console.log('\n📋 Alternative Testing Approach:');
    console.log('Since creating a full Raydium pool is complex, we can:');
    console.log('1. Use mock pool data for testing the wrapper');
    console.log('2. Focus on the FIFO ordering mechanism');
    console.log('3. Test with simplified pool accounts');
    
    // Create a test pool configuration with all required accounts
    const testPoolConfig = {
        // Pool identification
        poolId: PublicKey.findProgramAddressSync(
            [Buffer.from('test_pool_v1')],
            RAYDIUM_AMM_V4
        )[0].toBase58(),
        
        // Program IDs
        ammProgramId: RAYDIUM_AMM_V4.toBase58(),
        serumProgramId: 'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
        tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        
        // Authority (for testing, use a PDA)
        ammAuthority: PublicKey.findProgramAddressSync(
            [Buffer.from('amm_authority')],
            RAYDIUM_AMM_V4
        )[0].toBase58(),
        
        // Mock accounts (these would be real in production)
        openOrders: Keypair.generate().publicKey.toBase58(),
        targetOrders: Keypair.generate().publicKey.toBase58(),
        poolCoinTokenAccount: Keypair.generate().publicKey.toBase58(),
        poolPcTokenAccount: Keypair.generate().publicKey.toBase58(),
        
        // Market accounts (mock)
        serumMarket: Keypair.generate().publicKey.toBase58(),
        serumBids: Keypair.generate().publicKey.toBase58(),
        serumAsks: Keypair.generate().publicKey.toBase58(),
        serumEventQueue: Keypair.generate().publicKey.toBase58(),
        serumCoinVaultAccount: Keypair.generate().publicKey.toBase58(),
        serumPcVaultAccount: Keypair.generate().publicKey.toBase58(),
        serumVaultSigner: Keypair.generate().publicKey.toBase58(),
        
        // LP token
        lpMint: Keypair.generate().publicKey.toBase58(),
        
        // Config
        isTestPool: true,
        note: 'This is a test configuration for development. Use real pool accounts in production.'
    };
    
    fs.writeFileSync(
        path.join(__dirname, '../test-pool-config-devnet.json'),
        JSON.stringify(testPoolConfig, null, 2)
    );
    
    console.log('\n💾 Test pool configuration saved');
}

// Import Keypair for mock account generation
import { Keypair } from '@solana/web3.js';

main().catch(console.error);