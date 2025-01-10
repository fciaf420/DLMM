# DLMM SDK Position Tracker

A TypeScript application for tracking Meteora DLMM positions, built using the official DLMM SDK. This fork includes an enhanced position checker with advanced features.

## Enhanced Position Checker Features

- 📊 Real-time position monitoring with automatic updates
- 💰 PnL tracking with initial deposit information
- 📈 RSI calculations for tokens
- 💵 Detailed fee tracking (claimed and unclaimed)
- 📍 Visual range indicators for position status
- ⚡ Dynamic fee information
- 🔄 Configurable update intervals
- 🎯 Improved error handling and retries

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/fciaf420/DLMM.git
   cd DLMM
   ```

2. Switch to the enhanced position checker branch:
   ```bash
   git checkout feature/enhanced-position-checker
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

5. Configure your environment variables in `.env`:
   ```
   # Required
   SOLANA_RPC_ENDPOINT=https://your-rpc-endpoint.com
   WALLET_PUBLIC_KEY=your_wallet_public_key_here

   # Optional
   UPDATE_INTERVAL=60000        # Update frequency in ms (default: 60000)
   ERROR_RETRY_DELAY=5000      # Retry delay in ms (default: 5000)
   RANGE_BAR_WIDTH=20          # Visual range width (default: 20)
   ```

6. Run the enhanced position checker:
   ```bash
   npx ts-node examples/check-position.ts
   ```

## Position Checker Output

The enhanced position checker provides detailed information for each position:
- Position ID and pool address
- Token pair information with current prices
- Position range status with visual indicator
- Current bin location and range
- Liquidity value in USD
- Claimed and unclaimed fees
- PnL calculations
- Initial deposit information
- RSI indicators
- Dynamic fee rates

## Configuration Options

All configuration options can be set via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| SOLANA_RPC_ENDPOINT | Yes | - | Your Solana RPC endpoint |
| WALLET_PUBLIC_KEY | Yes | - | Your wallet's public key |
| UPDATE_INTERVAL | No | 60000 | Update frequency in milliseconds |
| ERROR_RETRY_DELAY | No | 5000 | Error retry delay in milliseconds |
| RANGE_BAR_WIDTH | No | 20 | Width of position range visualization |

## Dependencies

- @meteora-ag/dlmm
- @solana/web3.js
- @coral-xyz/anchor
- dotenv
- bn.js

## Original DLMM SDK

This is a fork of the official DLMM SDK. For the original version, visit [Meteora DLMM SDK](https://github.com/meteora-ag/dlmm).

## License

Private repository - All rights reserved