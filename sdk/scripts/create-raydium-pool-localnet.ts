import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Raydium, TxVersion, parseTokenAccountResp } from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const LOCALNET_URL = 'http://127.0.0.1:8899';

// Load deployed program ID
const deploymentInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '../deployment-localnet.json'), 'utf8'));
const RAYDIUM_AMM_PROGRAM_ID = new PublicKey(deploymentInfo.raydiumAmm.programId);

// OpenBook program ID for localnet (we'll need to deploy this or use a mock)
const OPENBOOK_PROGRAM_ID = new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'); // Default OpenBook program

async function main() {
    console.log('Creating Raydium pool on localnet...');
    
    const connection = new Connection(LOCALNET_URL, 'confirmed');
    
    // Load test wallet and token info
    const testWalletData = JSON.parse(fs.readFileSync('test-wallet.json', 'utf8'));
    const testWallet = Keypair.fromSecretKey(new Uint8Array(testWalletData));
    
    const tokenInfo = JSON.parse(fs.readFileSync('test-tokens.json', 'utf8'));
    const tokaMint = new PublicKey(tokenInfo.toka.mint);
    const tokbMint = new PublicKey(tokenInfo.tokb.mint);
    
    console.log('Test wallet:', testWallet.publicKey.toBase58());
    console.log('TOKA mint:', tokaMint.toBase58());
    console.log('TOKB mint:', tokbMint.toBase58());
    
    try {
        // Initialize Raydium SDK V2
        console.log('\nInitializing Raydium SDK...');
        const raydium = await Raydium.load({
            connection,
            owner: testWallet,
            cluster: 'localnet',
            disableLoadToken: false,
            blockhashCommitment: 'confirmed',
        });
        
        console.log('Raydium SDK initialized');
        
        // Create market and pool parameters
        const baseAmount = new BN(100000).mul(new BN(10).pow(new BN(tokenInfo.toka.decimals))); // 100k TOKA
        const quoteAmount = new BN(100000).mul(new BN(10).pow(new BN(tokenInfo.tokb.decimals))); // 100k TOKB
        
        console.log('\nCreating market and pool...');
        console.log('Base amount (TOKA):', baseAmount.toString());
        console.log('Quote amount (TOKB):', quoteAmount.toString());
        
        // Create market and pool in one transaction
        const { execute, extInfo } = await raydium.liquidity.createMarketAndPoolV4({
            programId: RAYDIUM_AMM_PROGRAM_ID,
            marketProgram: OPENBOOK_PROGRAM_ID,
            baseMintInfo: {
                mint: tokaMint,
                decimals: tokenInfo.toka.decimals,
            },
            quoteMintInfo: {
                mint: tokbMint,
                decimals: tokenInfo.tokb.decimals,
            },
            baseAmount: baseAmount,
            quoteAmount: quoteAmount,
            startTime: new BN(0), // Start immediately
            ownerInfo: {
                feePayer: testWallet.publicKey,
                useSOLBalance: true,
            },
            associatedOnly: false,
            checkCreateATAOwner: true,
            makeTxVersion: TxVersion.V0,
            lookupTableCache: {},
            lotSize: 1,
            tickSize: 0.01,
            dexCreateFee: 0.1, // Small fee for localnet
        });
        
        console.log('\nSending transaction...');
        const { txId } = await execute({ sendAndConfirm: true });
        
        console.log('\nPool created successfully!');
        console.log('Transaction ID:', txId);
        console.log('Pool ID:', extInfo.address.ammId.toBase58());
        console.log('LP Mint:', extInfo.address.lpMint.toBase58());
        console.log('Market ID:', extInfo.address.marketId.toBase58());
        
        // Save pool info
        const poolInfo = {
            poolId: extInfo.address.ammId.toBase58(),
            lpMint: extInfo.address.lpMint.toBase58(),
            marketId: extInfo.address.marketId.toBase58(),
            baseVault: extInfo.address.baseVault.toBase58(),
            quoteVault: extInfo.address.quoteVault.toBase58(),
            baseMint: tokaMint.toBase58(),
            quoteMint: tokbMint.toBase58(),
            baseDecimals: tokenInfo.toka.decimals,
            quoteDecimals: tokenInfo.tokb.decimals,
            programId: RAYDIUM_AMM_PROGRAM_ID.toBase58(),
            marketProgramId: OPENBOOK_PROGRAM_ID.toBase58(),
            createdAt: new Date().toISOString(),
        };
        
        fs.writeFileSync('test-pool.json', JSON.stringify(poolInfo, null, 2));
        console.log('\nPool info saved to test-pool.json');
        
    } catch (error) {
        console.error('\nError creating pool:', error);
        if (error.logs) {
            console.error('Transaction logs:', error.logs);
        }
    }
}

main().catch(console.error);