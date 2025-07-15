#!/usr/bin/env ts-node
import { 
    Connection, 
    PublicKey
} from '@solana/web3.js';
import { 
    Liquidity,
    LIQUIDITY_STATE_LAYOUT_V4,
    MARKET_STATE_LAYOUT_V3,
    Market
} from '@raydium-io/raydium-sdk';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';

// Known Raydium pools on devnet
const KNOWN_POOLS = [
    '2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv', // SOL-USDC
    'EoNrn8iUhwgJySD1pHu8Qxm5gSQqLK3za4m8xzD2RuEb', // RAY-SOL
    // Add more if found
];

async function main() {
    console.log('🔍 Fetching Raydium Pool Accounts on Devnet...\n');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Raydium AMM V4 on devnet
    const RAYDIUM_AMM_V4 = new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8');
    
    for (const poolIdStr of KNOWN_POOLS) {
        console.log(`\n📊 Checking pool: ${poolIdStr}`);
        
        try {
            const poolId = new PublicKey(poolIdStr);
            const poolAccount = await connection.getAccountInfo(poolId);
            
            if (!poolAccount) {
                console.log('❌ Pool not found');
                continue;
            }
            
            if (!poolAccount.owner.equals(RAYDIUM_AMM_V4)) {
                console.log('❌ Not a Raydium AMM V4 pool, owner:', poolAccount.owner.toBase58());
                continue;
            }
            
            console.log('✅ Valid Raydium AMM V4 pool');
            
            // Decode pool state
            const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
            
            console.log('\n📋 Pool State:');
            console.log('Status:', poolState.status);
            console.log('Base Mint:', poolState.baseMint.toBase58());
            console.log('Quote Mint:', poolState.quoteMint.toBase58());
            console.log('LP Mint:', poolState.lpMint.toBase58());
            console.log('Open Orders:', poolState.openOrders.toBase58());
            console.log('Target Orders:', poolState.targetOrders.toBase58());
            console.log('Base Vault:', poolState.baseVault.toBase58());
            console.log('Quote Vault:', poolState.quoteVault.toBase58());
            console.log('Market ID:', poolState.marketId.toBase58());
            console.log('Market Program ID:', poolState.marketProgramId.toBase58());
            
            // Get market info
            const marketAccount = await connection.getAccountInfo(poolState.marketId);
            if (marketAccount) {
                console.log('\n📈 Market found');
                const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);
                
                console.log('Market Bids:', marketState.bids.toBase58());
                console.log('Market Asks:', marketState.asks.toBase58());
                console.log('Event Queue:', marketState.eventQueue.toBase58());
                console.log('Base Vault:', marketState.baseVault.toBase58());
                console.log('Quote Vault:', marketState.quoteVault.toBase58());
                console.log('Vault Signer Nonce:', marketState.vaultSignerNonce);
                
                // Calculate vault signer
                const [vaultSigner] = await PublicKey.findProgramAddress(
                    [poolState.marketId.toBuffer(), Buffer.from([marketState.vaultSignerNonce.toNumber()])],
                    poolState.marketProgramId
                );
                console.log('Vault Signer:', vaultSigner.toBase58());
                
                // Save complete pool configuration
                const poolConfig = {
                    poolId: poolId.toBase58(),
                    poolType: 'AMM_V4',
                    status: poolState.status,
                    baseMint: poolState.baseMint.toBase58(),
                    quoteMint: poolState.quoteMint.toBase58(),
                    lpMint: poolState.lpMint.toBase58(),
                    baseDecimals: poolState.baseDecimal,
                    quoteDecimals: poolState.quoteDecimal,
                    lpDecimals: 9, // Default LP decimals
                    
                    // Pool accounts
                    ammAuthority: Liquidity.getAssociatedAuthority({ programId: RAYDIUM_AMM_V4 }).publicKey.toBase58(),
                    openOrders: poolState.openOrders.toBase58(),
                    targetOrders: poolState.targetOrders.toBase58(),
                    baseVault: poolState.baseVault.toBase58(),
                    quoteVault: poolState.quoteVault.toBase58(),
                    
                    // Market info
                    marketId: poolState.marketId.toBase58(),
                    marketProgramId: poolState.marketProgramId.toBase58(),
                    marketAuthority: Market.getAssociatedAuthority({ programId: poolState.marketProgramId, marketId: poolState.marketId }).publicKey.toBase58(),
                    
                    // Serum/OpenBook accounts
                    serumBids: marketState.bids.toBase58(),
                    serumAsks: marketState.asks.toBase58(),
                    serumEventQueue: marketState.eventQueue.toBase58(),
                    serumCoinVaultAccount: marketState.baseVault.toBase58(),
                    serumPcVaultAccount: marketState.quoteVault.toBase58(),
                    serumVaultSigner: vaultSigner.toBase58(),
                    
                    // Program IDs
                    ammProgramId: RAYDIUM_AMM_V4.toBase58(),
                    
                    // Reserve amounts
                    baseReserve: '0', // Would need to fetch from token accounts
                    quoteReserve: '0', // Would need to fetch from token accounts
                    
                    fetchedAt: new Date().toISOString()
                };
                
                const filename = `raydium-pool-${poolId.toBase58().slice(0, 8)}-devnet.json`;
                fs.writeFileSync(
                    path.join(__dirname, `../${filename}`),
                    JSON.stringify(poolConfig, null, 2)
                );
                
                console.log(`\n💾 Pool configuration saved to ${filename}`);
                
                // Return after finding first valid pool
                return poolConfig;
            } else {
                console.log('❌ Market not found');
            }
            
        } catch (error) {
            console.error('❌ Error processing pool:', error);
        }
    }
    
    console.log('\n⚠️  No valid pools found with complete data');
}

main().catch(console.error);