# DLMM SDK Position Tracker

A TypeScript application for tracking Meteora DLMM positions, built using the official DLMM SDK.

## Features

- Track positions across all DLMM pools
- Display token information including names and addresses
- Show current prices and position values in USD
- Monitor swap fees and liquidity mining rewards
- View claimable rewards and fees

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your configuration:
   ```
   SOLANA_RPC_ENDPOINT="your_rpc_endpoint"
   WALLET_PUBLIC_KEY="your_wallet_public_key"
   COMMITMENT_LEVEL="confirmed"
   ```
4. Run the application:
   ```bash
   npm start
   ```

## Environment Variables

- `SOLANA_RPC_ENDPOINT`: Your Solana RPC endpoint
- `WALLET_PUBLIC_KEY`: The public key of the wallet to track
- `COMMITMENT_LEVEL`: (Optional) Solana commitment level, defaults to "confirmed"

## Dependencies

- @meteora-ag/dlmm
- @solana/web3.js
- @coral-xyz/anchor
- dotenv

## License

Private repository - All rights reserved