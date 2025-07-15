#!/usr/bin/env ts-node
import { 
    Connection, 
    PublicKey,
    GetProgramAccountsFilter
} from '@solana/web3.js';
import { 
    LIQUIDITY_STATE_LAYOUT_V4
} from '@raydium-io/raydium-sdk';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');

async function main() {
    console.log('🔍 Searching for Active Raydium Pools on Devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Get all accounts owned by Raydium AMM V4
    const filters: GetProgramAccountsFilter[] = [
        {
            dataSize: LIQUIDITY_STATE_LAYOUT_V4.span
        }
    ];
    
    console.log('Fetching accounts from Raydium AMM V4...');
    const accounts = await connection.getProgramAccounts(RAYDIUM_AMM_V4, {
        filters,
        commitment: 'confirmed'
    });
    
    console.log(`Found ${accounts.length} pool accounts\n`);
    
    const validPools = [];
    
    for (const { pubkey, account } of accounts.slice(0, 5)) { // Check first 5
        try {
            const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);
            
            console.log(`\n📊 Pool: ${pubkey.toBase58()}`);
            console.log(`  Status: ${poolState.status}`);
            console.log(`  Base: ${poolState.baseMint.toBase58().slice(0, 8)}...`);
            console.log(`  Quote: ${poolState.quoteMint.toBase58().slice(0, 8)}...`);
            console.log(`  LP: ${poolState.lpMint.toBase58().slice(0, 8)}...`);
            
            // Check if pool has valid status (1 = active)
            if (poolState.status.toNumber() === 1) {
                console.log('  ✅ Active pool');
                validPools.push({
                    poolId: pubkey.toBase58(),
                    baseMint: poolState.baseMint.toBase58(),
                    quoteMint: poolState.quoteMint.toBase58(),
                    lpMint: poolState.lpMint.toBase58(),
                    baseVault: poolState.baseVault.toBase58(),
                    quoteVault: poolState.quoteVault.toBase58(),
                    openOrders: poolState.openOrders.toBase58(),
                    targetOrders: poolState.targetOrders.toBase58(),
                    marketId: poolState.marketId.toBase58(),
                    marketProgramId: poolState.marketProgramId.toBase58()
                });
            }
        } catch (error) {
            console.log(`  ❌ Error decoding: ${error}`);
        }
    }
    
    if (validPools.length > 0) {
        console.log(`\n✅ Found ${validPools.length} active pools`);
        
        // Save first valid pool for testing
        const testPool = validPools[0];
        
        fs.writeFileSync(
            path.join(__dirname, '../raydium-active-pool-devnet.json'),
            JSON.stringify(testPool, null, 2)
        );
        
        console.log('\n💾 First active pool saved to raydium-active-pool-devnet.json');
        console.log('\nYou can use this pool ID for testing:', testPool.poolId);
    } else {
        console.log('\n⚠️  No active pools found');
    }
}

main().catch(console.error);