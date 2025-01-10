import { Connection, PublicKey, Commitment } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import dotenv from 'dotenv';
import BN from 'bn.js';
import path from 'path';
import { setTimeout } from 'timers/promises';

// Load environment variables from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Configuration options
const CONFIG = {
    // Token addresses
    SOL_TOKEN_ADDRESS: "So11111111111111111111111111111111111111112",
    
    // Display settings
    RANGE_BAR_WIDTH: 20,          // Width of the position range visualization
    
    // Time intervals (in milliseconds)
    UPDATE_INTERVAL: 60000,       // How often to refresh (1 minute)
    ERROR_RETRY_DELAY: 5000,      // How long to wait after error before retry
    
    // RPC settings (from .env)
    RPC_ENDPOINT: process.env.SOLANA_RPC_ENDPOINT!,
    WALLET_ADDRESS: process.env.WALLET_PUBLIC_KEY!
};

// Helper function to get token price from Jupiter API
async function getTokenPrice(tokenMint: string): Promise<number> {
    try {
        const response = await fetch(`https://api.jup.ag/price/v2?ids=${tokenMint}`);
        const data = await response.json();
        return data.data[tokenMint]?.price ? parseFloat(data.data[tokenMint].price) : 0;
    } catch (error) {
        console.error('Error fetching price:', error);
        return 0;
    }
}

// Helper function to get token name from Gecko Terminal
async function getTokenName(tokenMint: string): Promise<string> {
    try {
        const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${tokenMint}`);
        const data = await response.json();
        return data.data?.attributes?.name || tokenMint.slice(0, 4) + '...' + tokenMint.slice(-4);
    } catch (error) {
        console.error('Error fetching token name:', error);
        return tokenMint.slice(0, 4) + '...' + tokenMint.slice(-4);
    }
}

// Helper function to get the most liquid pool for a token
async function getMostLiquidPool(tokenMint: string): Promise<string | null> {
    try {
        const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${tokenMint}/pools?page=1`);
        const data = await response.json();
        
        if (!data.data?.length) {
            return null;
        }

        // Sort pools by reserve_in_usd and get the one with highest liquidity
        const sortedPools = data.data.sort((a: any, b: any) => 
            parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd)
        );

        return sortedPools[0].attributes.address;
    } catch (error) {
        console.error('Error getting most liquid pool:', error);
        return null;
    }
}

// Helper function to calculate RSI using GeckoTerminal OHLCV data
async function calculateRSI(tokenMint: string): Promise<number> {
    try {
        // Get the most liquid pool first
        const mostLiquidPool = await getMostLiquidPool(tokenMint);
        if (!mostLiquidPool) {
            console.log('No liquid pool found for token:', tokenMint);
            return 0;
        }

        // Fetch OHLCV data from the most liquid pool
        const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${mostLiquidPool}/ohlcv/minute?aggregate=5`);
        const data = await response.json();
        
        if (!data.data?.attributes?.ohlcv_list?.length) {
            return 0;
        }

        // OHLCV format: [timestamp, open, high, low, close, volume]
        const closes = data.data.attributes.ohlcv_list.map((candle: number[]) => candle[4]).reverse();
        const changes: number[] = [];
        
        // Calculate price changes
        for (let i = 1; i < closes.length; i++) {
            changes.push(closes[i] - closes[i - 1]);
        }

        // Initialize first average gain and loss (first 14 periods)
        let gainSum = 0;
        let lossSum = 0;
        for (let i = 0; i < 14 && i < changes.length; i++) {
            const change = changes[i];
            if (change > 0) {
                gainSum += change;
            } else {
                lossSum += Math.abs(change);
            }
        }
        
        let avgGain = gainSum / 14;
        let avgLoss = lossSum / 14;

        // Calculate subsequent values using Wilder's smoothing
        for (let i = 14; i < changes.length; i++) {
            const change = changes[i];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;

            avgGain = ((avgGain * 13) + gain) / 14;
            avgLoss = ((avgLoss * 13) + loss) / 14;
        }

        // Calculate final RSI
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        return rsi;
    } catch (error) {
        console.error('Error calculating RSI:', error);
        return 0;
    }
}

// Helper function to convert lamports to token amount
function lamportsToTokenAmount(lamports: BN, decimals: number): number {
    try {
        const divisor = new BN(10).pow(new BN(decimals));
        const quotient = lamports.div(divisor);
        const remainder = lamports.mod(divisor);
        const wholePart = quotient.toString();
        const fractionalPart = remainder.toString().padStart(decimals, '0');
        return parseFloat(`${wholePart}.${fractionalPart}`);
    } catch (err) {
        console.error('Error in lamportsToTokenAmount:', err);
        return 0;
    }
}

// Helper function to fetch initial deposit information
async function getInitialDeposit(positionAddress: string): Promise<any> {
    try {
        const response = await fetch(`https://dlmm-api.meteora.ag/position/${positionAddress}/deposits`);
        const deposits = await response.json();
        
        if (deposits && deposits.length > 0) {
            const deposit = deposits[0]; // Get the first deposit
            const timestamp = new Date(deposit.onchain_timestamp * 1000).toLocaleString();
            return {
                tokenXAmount: deposit.token_x_amount,
                tokenYAmount: deposit.token_y_amount,
                tokenXUsdAmount: deposit.token_x_usd_amount,
                tokenYUsdAmount: deposit.token_y_usd_amount,
                timestamp: timestamp,
                price: deposit.price
            };
        }
        return null;
    } catch (error) {
        console.error('Error fetching deposit information:', error);
        return null;
    }
}

// Add after imports
async function getCurrentDynamicFee(poolAddress: string): Promise<number | null> {
    try {
        const response = await fetch(`https://dlmm-api.meteora.ag/pair/${poolAddress}`);
        const data = await response.json();
        
        // Get base and max fees
        const baseFee = parseFloat(data.base_fee_percentage);
        const maxFee = parseFloat(data.max_fee_percentage);
        
        // For now, return base fee since that matches UI
        return baseFee;
        
        // Previous calculation was incorrect:
        // const volatilityFactor = 27/64;
        // const currentFee = baseFee + (volatilityFactor * (maxFee - baseFee));
    } catch (error) {
        console.error('Error fetching dynamic fee:', error);
        return null;
    }
}

console.log('Starting position check...');

async function main() {
    try {
        console.log('Initializing connection to Solana...');
        console.log('RPC Endpoint:', process.env.SOLANA_RPC_ENDPOINT);
        const connection = new Connection(
            process.env.SOLANA_RPC_ENDPOINT!,
            { commitment: 'confirmed' as Commitment }
        );

        const userPublicKey = new PublicKey(process.env.WALLET_PUBLIC_KEY!);
        console.log('Using wallet:', userPublicKey.toString());

        let totalLiquidityValue = 0;
        let totalClaimedFees = 0;
        let totalUnclaimedFees = 0;
        let totalPositions = 0;
        let inRangePositions = 0;
        let totalInitialValue = 0;  // Track total initial deposit value

        console.log('\nFetching positions...');
        const userPositions = await DLMM.getAllLbPairPositionsByUser(
            connection,
            userPublicKey
        );

        for (const [poolAddress, _] of userPositions.entries()) {
            const dlmmPool = await DLMM.create(connection, new PublicKey(poolAddress));
            const activeBin = await dlmmPool.getActiveBin();
            const currentBinId = activeBin.binId;
            
            const { userPositions: poolPositions } = await dlmmPool.getPositionsByUserAndLbPair(userPublicKey);
            const tokenXPrice = await getTokenPrice(dlmmPool.tokenX.publicKey.toString());
            const tokenYPrice = await getTokenPrice(dlmmPool.tokenY.publicKey.toString());

            // Determine which token is SOL and which is the other token
            const solTokenPublicKey = CONFIG.SOL_TOKEN_ADDRESS;
            const nonSolToken = dlmmPool.tokenX.publicKey.toString() === solTokenPublicKey ? dlmmPool.tokenY : dlmmPool.tokenX;
            const rsi = await calculateRSI(nonSolToken.publicKey.toString());
            const tokenName = await getTokenName(nonSolToken.publicKey.toString());

            for (const positionDetails of poolPositions) {
                totalPositions++;
                const { positionData } = positionDetails;
                
                const isInRange = currentBinId >= positionData.lowerBinId && currentBinId <= positionData.upperBinId;
                if (isInRange) inRangePositions++;

                let xAmount = BN.isBN(positionData.totalXAmount) 
                    ? positionData.totalXAmount 
                    : new BN(positionData.totalXAmount.toString().split('.')[0]);
                let yAmount = BN.isBN(positionData.totalYAmount)
                    ? positionData.totalYAmount
                    : new BN(positionData.totalYAmount.toString().split('.')[0]);

                const tokenXAmount = Number(xAmount.toString()) / Math.pow(10, dlmmPool.tokenX.decimal);
                const tokenYAmount = Number(yAmount.toString()) / Math.pow(10, dlmmPool.tokenY.decimal);
                const tokenXValue = tokenXAmount * tokenXPrice;
                const tokenYValue = tokenYAmount * tokenYPrice;
                
                const claimedXAmount = Number(positionData.totalClaimedFeeXAmount.toString()) / Math.pow(10, dlmmPool.tokenX.decimal);
                const claimedYAmount = Number(positionData.totalClaimedFeeYAmount.toString()) / Math.pow(10, dlmmPool.tokenY.decimal);
                const claimableXAmount = Number((positionData.feeX || new BN(0)).toString()) / Math.pow(10, dlmmPool.tokenX.decimal);
                const claimableYAmount = Number((positionData.feeY || new BN(0)).toString()) / Math.pow(10, dlmmPool.tokenY.decimal);

                const positionValue = tokenXValue + tokenYValue;
                const claimedValue = (claimedXAmount * tokenXPrice) + (claimedYAmount * tokenYPrice);
                const unclaimedValue = (claimableXAmount * tokenXPrice) + (claimableYAmount * tokenYPrice);
                const totalCurrentValue = positionValue + claimedValue + unclaimedValue;

                totalLiquidityValue += positionValue;
                totalClaimedFees += claimedValue;
                totalUnclaimedFees += unclaimedValue;

                // Create visual range indicator
                const rangeWidth = CONFIG.RANGE_BAR_WIDTH;
                const currentBinPosition = Math.min(Math.max(
                    Math.round(((currentBinId - positionData.lowerBinId) / (positionData.upperBinId - positionData.lowerBinId)) * rangeWidth),
                    0), rangeWidth);
                const rangeBar = '─'.repeat(currentBinPosition) + (isInRange ? '●' : '○') + '─'.repeat(rangeWidth - currentBinPosition);

                console.log('\n🔍 === Position Information ===');
                console.log(`📍 Position ID: ${positionDetails.publicKey.toString()}`);
                console.log(`🏦 Pool: ${poolAddress}`);
                console.log(`💱 Pair: SOL/${tokenName}`);
                const { baseFeeRatePercentage } = dlmmPool.getFeeInfo();
                console.log(`💰 Base Fee: ${baseFeeRatePercentage.toFixed(4)}%`);
                
                // Add dynamic fee display
                const currentDynamicFee = await getCurrentDynamicFee(poolAddress);
                if (currentDynamicFee !== null) {
                    console.log(`📊 Current Dynamic Fee: ${currentDynamicFee.toFixed(6)}%`);
                }
                
                console.log(`📊 Status: ${isInRange ? '🟢 IN RANGE' : '🔴 OUT OF RANGE'}`);
                console.log(`\n📐 Bin Configuration:`);
                console.log(`└── Range: [${positionData.lowerBinId} to ${positionData.upperBinId}]`);
                console.log(`└── Current Bin: ${currentBinId}`);
                console.log(`└── Position: |${rangeBar}|  ${isInRange ? '(Active)' : '(Inactive)'}`);

                console.log('\n└── 💵 Value Breakdown');
                console.log(`   ├── Position Value: $${positionValue.toFixed(2)}`);
                console.log(`   ├── Claimed Fees: $${claimedValue.toFixed(2)}`);
                console.log(`   ├── Unclaimed Fees: $${unclaimedValue.toFixed(2)}`);
                console.log(`   └── Total Current Value: $${(positionValue + claimedValue + unclaimedValue).toFixed(2)}`);
                console.log(`\n📈 Total Fees (Claimed + Unclaimed): $${(claimedValue + unclaimedValue).toFixed(2)}`);
                console.log(`📊 5min RSI (${tokenName}): ${rsi.toFixed(2)}`);

                // Add initial deposit information and PnL
                const depositInfo = await getInitialDeposit(positionDetails.publicKey.toString());
                if (depositInfo) {
                    const initialValue = depositInfo.tokenXUsdAmount + depositInfo.tokenYUsdAmount;
                    totalInitialValue += initialValue;
                    // Total current value includes position value plus all fees
                    const totalCurrentValue = positionValue + claimedValue + unclaimedValue;
                    const pnl = totalCurrentValue - initialValue;
                    const pnlPercentage = (pnl / initialValue) * 100;

                    console.log('\n📝 Initial Deposit Information:');
                    console.log(`└── 🕒 Timestamp: ${depositInfo.timestamp}`);
                    console.log(`└── 💲 Initial Price: $${depositInfo.price.toFixed(8)}`);
                    console.log(`└── 💰 Initial Value: $${initialValue.toFixed(2)}`);
                    console.log(`└── 💵 Current Total Value: $${totalCurrentValue.toFixed(2)}`);
                    const pnlEmoji = pnl >= 0 ? '📈' : '📉';
                    console.log(`└── ${pnlEmoji} PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercentage >= 0 ? '+' : ''}${pnlPercentage.toFixed(2)}%)`);
                }
                console.log('\n' + '─'.repeat(50));
            }
        }

        console.log('\n🏦 ==========================================');
        console.log('📊 WALLET SUMMARY');
        console.log('==========================================');
        console.log('\n📈 Position Overview');
        console.log(`└── 📍 Total Positions: ${totalPositions}`);
        console.log(`└── 🟢 Positions In Range: ${inRangePositions}`);
        console.log(`└── 🔴 Positions Out of Range: ${totalPositions - inRangePositions}`);
        
        console.log('\n💰 VALUE BREAKDOWN');
        console.log(`└── 📥 Initial Investment`);
        console.log(`    └── Total Initial Value: $${totalInitialValue.toFixed(2)}`);
        console.log(`\n└── 📊 Current Holdings`);
        console.log(`    ├── Position Value: $${totalLiquidityValue.toFixed(2)}`);
        console.log(`    ├── Claimed Fees: $${totalClaimedFees.toFixed(2)}`);
        console.log(`    ├── Unclaimed Fees: $${totalUnclaimedFees.toFixed(2)}`);
        console.log(`    └── Total Current Value: $${(totalLiquidityValue + totalClaimedFees + totalUnclaimedFees).toFixed(2)}`);
        
        const totalPnL = (totalLiquidityValue + totalClaimedFees + totalUnclaimedFees) - totalInitialValue;
        const totalPnLPercentage = totalInitialValue > 0 ? (totalPnL / totalInitialValue) * 100 : 0;
        const pnlEmoji = totalPnL >= 0 ? '📈' : '📉';
        console.log(`\n${pnlEmoji} TOTAL PnL: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)} (${totalPnLPercentage >= 0 ? '+' : ''}${totalPnLPercentage.toFixed(2)}%)`);
        console.log('==========================================');

    } catch (error) {
        console.error('Error:', error);
    }
}

async function clearScreen() {
    // Clear screen based on platform
    process.stdout.write(process.platform === 'win32' ? '\x1Bc' : '\x1B[2J\x1B[3J\x1B[H');
}

async function monitorPositions() {
    while (true) {
        try {
            await clearScreen();
            console.log(`\n🔄 Last Update: ${new Date().toLocaleTimeString()}`);
            await main();
            console.log('\n⏳ Refreshing in ' + (CONFIG.UPDATE_INTERVAL / 1000) + ' seconds...');
            await setTimeout(CONFIG.UPDATE_INTERVAL);
        } catch (error) {
            console.error('Error in monitoring loop:', error);
            await setTimeout(CONFIG.ERROR_RETRY_DELAY);
        }
    }
}

// Start monitoring instead of single main() call
console.log('Starting position monitor (refreshes every minute)...');
monitorPositions(); 