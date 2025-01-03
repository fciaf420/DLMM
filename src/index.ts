import { Connection, PublicKey, Commitment } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Helper function to get PDA for token metadata
async function findMetadataAddress(mint: PublicKey): Promise<PublicKey> {
    const [publicKey] = await PublicKey.findProgramAddress(
        [
            Buffer.from('metadata'),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
    );
    return publicKey;
}

// Helper function to get token metadata
async function getTokenMetadata(connection: Connection, mint: PublicKey) {
    try {
        const metadataAddress = await findMetadataAddress(mint);
        const accountInfo = await connection.getAccountInfo(metadataAddress);
        
        if (accountInfo) {
            // Skip the first byte which is the version
            const buffer = accountInfo.data.slice(1);
            
            // Get name length (first 4 bytes after version)
            const nameLength = buffer.slice(0, 4).readUInt32LE(0);
            // Get name
            const name = buffer.slice(4, 4 + nameLength).toString('utf8').replace(/\0/g, '');
            
            // Get symbol length
            const symbolLength = buffer.slice(4 + nameLength, 8 + nameLength).readUInt32LE(0);
            // Get symbol
            const symbol = buffer.slice(8 + nameLength, 8 + nameLength + symbolLength).toString('utf8').replace(/\0/g, '');
            
            return { name, symbol };
        }
    } catch (error) {
        // Ignore errors, will fallback to on-chain account data
    }
    return null;
}

// Helper function to format number with decimals
function formatWithDecimals(amount: number | string, decimals: number): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return (num / Math.pow(10, decimals)).toFixed(decimals);
}

// Helper function to format USD value
function formatUSD(amount: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Helper function to format SOL value
function formatSOL(amount: number): string {
    return `${amount.toFixed(4)} SOL`;
}

// Helper function to format token info
function formatTokenInfo(symbol: string, name: string | undefined | null, address: string): string {
    return `${symbol}${name ? ` (${name})` : ''} - Address: ${address}`;
}

async function main() {
    try {
        // Initialize connection
        const connection = new Connection(
            process.env.SOLANA_RPC_ENDPOINT!,
            { commitment: (process.env.COMMITMENT_LEVEL || 'confirmed') as Commitment }
        );

        // Your wallet public key
        const userPublicKey = new PublicKey(process.env.WALLET_PUBLIC_KEY!);

        console.log('Fetching your positions...');
        
        // Get all positions for the user
        const userPositions = await DLMM.getAllLbPairPositionsByUser(
            connection,
            userPublicKey
        );

        if (userPositions.size === 0) {
            console.log('No positions found for this wallet.');
            return;
        }

        console.log(`Found positions in ${userPositions.size} pools\n`);

        // Get SOL price from Jupiter API V2
        const solPriceResponse = await fetch('https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112');
        const solPriceData = await solPriceResponse.json();
        const solPrice = parseFloat(solPriceData.data.So11111111111111111111111111111111111111112.price);

        // Process each position
        for (const [poolAddress, positions] of userPositions.entries()) {
            try {
                console.log(`\nProcessing pool: ${poolAddress}`);
                const dlmmPool = await DLMM.create(connection, new PublicKey(poolAddress));
                const activeBin = await dlmmPool.getActiveBin();
                
                // Get token information and mint info
                const tokenXInfo = await connection.getParsedAccountInfo(dlmmPool.tokenX.publicKey);
                const tokenYInfo = await connection.getParsedAccountInfo(dlmmPool.tokenY.publicKey);
                const tokenXDecimals = (tokenXInfo.value?.data as any)?.parsed?.info?.decimals || 9;
                const tokenYDecimals = (tokenYInfo.value?.data as any)?.parsed?.info?.decimals || 9;
                
                // Get token metadata
                const tokenXMetadata = await getTokenMetadata(connection, dlmmPool.tokenX.publicKey);
                const tokenYMetadata = await getTokenMetadata(connection, dlmmPool.tokenY.publicKey);
                
                // Get token names and symbols, prioritizing metadata over account info
                const tokenXSymbol = tokenXMetadata?.symbol || (tokenXInfo.value?.data as any)?.parsed?.info?.symbol || 'Token X';
                const tokenYSymbol = tokenYMetadata?.symbol || (tokenYInfo.value?.data as any)?.parsed?.info?.symbol || 'Token Y';
                const tokenXName = tokenXMetadata?.name || (tokenXInfo.value?.data as any)?.parsed?.info?.name;
                const tokenYName = tokenYMetadata?.name || (tokenYInfo.value?.data as any)?.parsed?.info?.name;
                
                // Get token prices if available
                let tokenXPrice = 0;
                let tokenYPrice = 0;

                try {
                    const tokenPriceResponse = await fetch(`https://api.jup.ag/price/v2?ids=${dlmmPool.tokenX.publicKey.toString()},${dlmmPool.tokenY.publicKey.toString()}`);
                    const tokenPriceData = await tokenPriceResponse.json();
                    tokenXPrice = parseFloat(tokenPriceData.data[dlmmPool.tokenX.publicKey.toString()]?.price || '0');
                    tokenYPrice = parseFloat(tokenPriceData.data[dlmmPool.tokenY.publicKey.toString()]?.price || '0');
                } catch (error) {
                    // If token price fetch fails, try to derive from SOL if one token is SOL
                    if (dlmmPool.tokenY.publicKey.toString() === 'So11111111111111111111111111111111111111112') {
                        tokenYPrice = solPrice;
                        tokenXPrice = solPrice * parseFloat(activeBin.price);
                    }
                }
                
                console.log('\n=== Pool Information ===');
                console.log('Token Pair:');
                console.log('Token 1:', formatTokenInfo(tokenXSymbol, tokenXName, dlmmPool.tokenX.publicKey.toString()));
                console.log('Token 2:', formatTokenInfo(tokenYSymbol, tokenYName, dlmmPool.tokenY.publicKey.toString()));
                
                const activeBinPrice = dlmmPool.fromPricePerLamport(Number(activeBin.price));
                console.log(`\nCurrent Price: ${activeBinPrice} ${tokenYSymbol}/${tokenXSymbol}`);
                if (tokenXPrice > 0) {
                    console.log(`${tokenXSymbol} Price: ${formatUSD(tokenXPrice)}`);
                }
                if (tokenYPrice > 0) {
                    console.log(`${tokenYSymbol} Price: ${formatUSD(tokenYPrice)}`);
                }

                // Get all positions for this pool
                const { userPositions: poolPositions } = await dlmmPool.getPositionsByUserAndLbPair(userPublicKey);

                // Display position details
                for (const positionDetails of poolPositions) {
                    try {
                        const { positionData } = positionDetails;
                        
                        console.log('\n=== Position Information ===');
                        console.log('Position ID:', positionDetails.publicKey.toString());
                        
                        // Calculate position values
                        const xAmount = parseFloat(formatWithDecimals(positionData.totalXAmount, tokenXDecimals));
                        const yAmount = parseFloat(formatWithDecimals(positionData.totalYAmount, tokenYDecimals));
                        
                        // Calculate total value
                        let totalValueUSD = 0;
                        if (tokenXPrice > 0 && tokenYPrice > 0) {
                            totalValueUSD = (xAmount * tokenXPrice) + (yAmount * tokenYPrice);
                        } else if (tokenYPrice > 0) {
                            // If only Y token price is known (e.g., SOL)
                            totalValueUSD = yAmount * tokenYPrice + (xAmount * parseFloat(activeBinPrice) * tokenYPrice);
                        }
                        
                        // Total Position Value
                        console.log('\nTotal Position Value:');
                        console.log(`${tokenXSymbol}: ${xAmount} (${formatUSD(xAmount * tokenXPrice)})`);
                        console.log(`${tokenYSymbol}: ${yAmount} (${formatUSD(yAmount * tokenYPrice)})`);
                        console.log(`Total Value: ${formatUSD(totalValueUSD)}`);
                        
                        // Fees and Rewards
                        console.log('\nFees Information:');
                        try {
                            const dynamicFee = dlmmPool.getDynamicFee();
                            console.log(`Current Fee Rate: ${dynamicFee.toNumber() / 100}%`);
                        } catch (error) {
                            // Ignore fee errors
                        }

                        // Show claimed fees
                        const claimedXFees = parseFloat(formatWithDecimals(positionData.totalClaimedFeeXAmount.toString(), tokenXDecimals));
                        const claimedYFees = parseFloat(formatWithDecimals(positionData.totalClaimedFeeYAmount.toString(), tokenYDecimals));
                        
                        const claimedFeesUSD = (claimedXFees * tokenXPrice) + (claimedYFees * tokenYPrice);
                        
                        console.log('\nTotal Claimed Fees:');
                        console.log(`${tokenXSymbol}: ${claimedXFees} (${formatUSD(claimedXFees * tokenXPrice)})`);
                        console.log(`${tokenYSymbol}: ${claimedYFees} (${formatUSD(claimedYFees * tokenYPrice)})`);
                        console.log(`Total Claimed Value: ${formatUSD(claimedFeesUSD)}`);

                        // Try to get claimable amounts
                        console.log('\nCurrently Claimable:');
                        try {
                            const swapFeeInfo = await dlmmPool.claimSwapFee({
                                position: positionDetails,
                                owner: userPublicKey
                            });
                            if (swapFeeInfo) {
                                console.log('Swap Fees Available - Use claim function to see exact amount');
                            }
                        } catch (error) {
                            console.log('No claimable swap fees');
                        }

                        try {
                            const lmRewardInfo = await dlmmPool.claimLMReward({
                                position: positionDetails,
                                owner: userPublicKey
                            });
                            if (lmRewardInfo) {
                                console.log('LM Rewards Available - Use claim function to see exact amount');
                            }
                        } catch (error) {
                            console.log('No claimable LM rewards');
                        }
                        
                        console.log('\n' + '-'.repeat(50));
                    } catch (positionError) {
                        console.error('Error processing position:', positionError);
                    }
                }
            } catch (error) {
                console.error(`Error processing pool ${poolAddress}:`, error);
                continue;
            }
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

main(); 