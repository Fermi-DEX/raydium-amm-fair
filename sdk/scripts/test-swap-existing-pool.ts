import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, getAccount } from '@solana/spl-token';
import { ContinuumSDK } from '../src/ContinuumSDK';
import { SwapParams } from '../src/types';
import { Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import * as fs from 'fs';

const DEVNET_URL = 'https://api.devnet.solana.com';

// Well-known devnet pool: SOL-USDC
const DEVNET_POOLS = {
    'SOL-USDC': {
        poolId: '2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv', // Example devnet pool
        coinMint: 'So11111111111111111111111111111111111111112', // SOL
        pcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet
    }
};

async function testSwapWithExistingPool() {
    console.log('Testing swap with existing Raydium pool on devnet...');
    
    const connection = new Connection(DEVNET_URL, 'confirmed');
    
    // Load test wallet
    const walletPath = 'test-wallet-devnet.json';
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const testWallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    const wallet = new Wallet(testWallet);
    
    console.log('Test wallet:', testWallet.publicKey.toBase58());
    
    // Check SOL balance
    const balance = await connection.getBalance(testWallet.publicKey);
    console.log('SOL balance:', balance / LAMPORTS_PER_SOL);
    
    if (balance < 0.1 * LAMPORTS_PER_SOL) {
        console.log('Insufficient SOL balance for swap fees');
        return;
    }
    
    try {
        // Initialize Continuum SDK
        console.log('\nInitializing Continuum SDK...');
        const sdk = new ContinuumSDK(connection, wallet, {
            raydiumProgramId: new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8'), // Devnet Raydium
        });
        
        console.log('SDK initialized');
        
        // Check if FIFO state exists, if not initialize it
        try {
            const sequence = await sdk.getCurrentSequence();
            console.log('Current FIFO sequence:', sequence.toString());
        } catch (error) {
            console.log('Initializing FIFO state...');
            const initTx = await sdk.initializeFifoState(testWallet);
            console.log('FIFO state initialized:', initTx);
        }
        
        // For this test, we'll use our custom tokens with a mock pool
        // In production, you would fetch pool info from chain
        const tokenInfo = JSON.parse(fs.readFileSync('test-tokens-devnet.json', 'utf8'));
        
        // Create a mock pool configuration for testing
        // Note: In real usage, these would be fetched from the actual pool account
        const mockPoolInfo = {
            poolId: Keypair.generate().publicKey,
            ammAuthority: Keypair.generate().publicKey,
            openOrders: Keypair.generate().publicKey,
            targetOrders: Keypair.generate().publicKey,
            poolCoinTokenAccount: Keypair.generate().publicKey,
            poolPcTokenAccount: Keypair.generate().publicKey,
            serumProgram: new PublicKey('DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY'), // Devnet OpenBook
            serumMarket: Keypair.generate().publicKey,
            serumBids: Keypair.generate().publicKey,
            serumAsks: Keypair.generate().publicKey,
            serumEventQueue: Keypair.generate().publicKey,
            serumCoinVaultAccount: Keypair.generate().publicKey,
            serumPcVaultAccount: Keypair.generate().publicKey,
            serumVaultSigner: Keypair.generate().publicKey,
        };
        
        console.log('\nPreparing swap parameters...');
        
        // Get user token accounts
        const userTokaAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            testWallet,
            new PublicKey(tokenInfo.toka.mint),
            testWallet.publicKey
        );
        
        const userTokbAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            testWallet,
            new PublicKey(tokenInfo.tokb.mint),
            testWallet.publicKey
        );
        
        // Prepare swap params (swap 100 TOKA for TOKB)
        const swapParams: SwapParams = {
            user: testWallet,
            userSource: userTokaAccount.address,
            userDestination: userTokbAccount.address,
            amountIn: new BN(100).mul(new BN(10).pow(new BN(9))), // 100 tokens
            minimumAmountOut: new BN(90).mul(new BN(10).pow(new BN(9))), // Accept 90 minimum (10% slippage)
            poolId: mockPoolInfo.poolId,
            ammAuthority: mockPoolInfo.ammAuthority,
            openOrders: mockPoolInfo.openOrders,
            targetOrders: mockPoolInfo.targetOrders,
            poolCoinTokenAccount: mockPoolInfo.poolCoinTokenAccount,
            poolPcTokenAccount: mockPoolInfo.poolPcTokenAccount,
            serumProgram: mockPoolInfo.serumProgram,
            serumMarket: mockPoolInfo.serumMarket,
            serumBids: mockPoolInfo.serumBids,
            serumAsks: mockPoolInfo.serumAsks,
            serumEventQueue: mockPoolInfo.serumEventQueue,
            serumCoinVaultAccount: mockPoolInfo.serumCoinVaultAccount,
            serumPcVaultAccount: mockPoolInfo.serumPcVaultAccount,
            serumVaultSigner: mockPoolInfo.serumVaultSigner,
            coinMint: new PublicKey(tokenInfo.toka.mint),
            pcMint: new PublicKey(tokenInfo.tokb.mint),
        };
        
        console.log('\nSwap parameters:');
        console.log('- Amount in: 100 TOKA');
        console.log('- Minimum out: 90 TOKB');
        console.log('- Using mock pool for demonstration');
        
        // Note: This will fail with mock pool data
        // In real usage, you need actual pool account data
        console.log('\nNote: Swap execution will fail with mock pool data.');
        console.log('To perform real swaps:');
        console.log('1. Use an existing Raydium pool on devnet');
        console.log('2. Or create a real pool using Raydium UI/SDK');
        console.log('3. Fetch actual pool account data from chain');
        
    } catch (error: any) {
        console.error('\nError:', error.message || error);
    }
}

testSwapWithExistingPool().catch(console.error);