# Sponsorship SDK Setup Guide

## Overview

This guide will help you set up and run the complete Sponsorship SDK system, which consists of:
- **Sponsorship API**: NestJS backend that handles gas sponsorship using ZeroDev SDK and EIP-7702
- **Sponsorship Frontend**: Next.js frontend for interacting with the sponsorship system

## Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (version 18 or higher)
- **npm** (comes with Node.js)
- **Git**

## Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/sponsorship-sdk.git
cd sponsorship-sdk
```

## Step 2: Set Up the Sponsorship API (Backend)

### 2.1 Navigate to the API directory
```bash
cd sponsorship-api
```

### 2.2 Install dependencies
```bash
npm install
```

### 2.3 Configure Environment Variables

Create a `.env` file in the `sponsorship-api` directory:

```bash
cp .env.example .env  # If you have an example file, or create manually
```

Add the following environment variables to your `.env` file:

```env
# API Security
API_KEY=your-secret-api-key

# ZeroDev Configuration
ZERODEV_RPC=https://rpc.zerodev.app/api/v3/YOUR_PROJECT_ID
ZERODEV_BUNDLER_RPC=https://rpc.zerodev.app/api/v3/YOUR_PROJECT_ID/chain/137
NEXT_PUBLIC_ZERODEV_RPC=https://rpc.zerodev.app/api/v3/YOUR_PROJECT_ID/chain/137

# Blockchain Configuration
CHAIN_ID=137
ENTRYPOINT_VERSION=0.7.0

# RPC URLs
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_API_KEY
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_API_KEY

# Testing Configuration
TEST_PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

# Additional Configuration
TO_ADDRESS=0xCC213cb9578565c25B2365C4d586cf2F88F04BE0
SPONSOR_API_BASE_URL=http://localhost:3000
SPONSOR_API_KEY=your-secret-api-key
API_BASE_URL=https://duke-gas.onrender.com

# Paymaster Configuration
POLYGON_ERC20_PAYMASTER=

# Script Configuration
RUN_COUNT=1440
DELAY_MS=600000
CSV_FILE=gas-results.csv
```

### 2.4 Required External Services Setup

You'll need to obtain the following:

#### ZeroDev Account
1. Go to [ZeroDev Dashboard](https://dashboard.zerodev.app/)
2. Create an account and project
3. Copy your Project ID and replace `YOUR_PROJECT_ID` in the URLs above

#### Alchemy Account (for RPC access)
1. Go to [Alchemy](https://www.alchemy.com/)
2. Create an account and get your API key
3. Replace `YOUR_ALCHEMY_API_KEY` in the RPC URLs above

#### Private Key Setup
⚠️ **Security Warning**: Never use real private keys with funds in development. Use test accounts only.

1. Create a test wallet or use a development private key
2. Replace the private key values in the `.env` file
3. Ensure the test wallet has some test tokens for gas fees

### 2.5 Build and Start the API
```bash
# Build the application
npm run build

# Start in development mode
npm run start:dev

# Or start in production mode
npm run start:prod
```

The API will be available at `http://localhost:3000`

### 2.6 Test the API Setup

You can test the API endpoints:

```bash
# Test the prepare endpoint
curl -X POST http://localhost:3000/sponsorships/prepare \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: your-secret-api-key" \
  -d '{
    "from": "0x1111111111111111111111111111111111111111",
    "to": "0x2222222222222222222222222222222222222222",
    "data": "0x",
    "value": "0"
  }'
```

## Step 3: Set Up the Frontend

### 3.1 Navigate to the Frontend directory
```bash
cd ../sponsorship-frontend
```

### 3.2 Install dependencies
```bash
npm install
```

### 3.3 Configure Environment Variables

Create a `.env.local` file in the `sponsorship-frontend` directory:

```env
NEXT_PUBLIC_API_BASE_URL=https://duke-gas.onrender.com
NEXT_PUBLIC_POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_API_KEY
NEXT_PUBLIC_BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_API_KEY
NEXT_PUBLIC_BUNDLER_RPC_URL_POLYGON=https://rpc.zerodev.app/api/v3/YOUR_PROJECT_ID/chain/137
NEXT_PUBLIC_BUNDLER_RPC_URL_BASE=https://rpc.zerodev.app/api/v3/YOUR_PROJECT_ID/chain/8453
NEXT_PUBLIC_API_KEY=your-secret-api-key
```

Replace the placeholder values with your actual API keys and project IDs.

### 3.4 Start the Frontend
```bash
# Start in development mode
npm run dev

# Or build and start in production mode
npm run build
npm start
```

The frontend will be available at `http://localhost:3000` (if API is running on a different port) or `http://localhost:3001`

## Step 4: Run End-to-End Tests

### 4.1 Test the Complete Flow

Navigate back to the API directory and run the test script:

```bash
cd ../sponsorship-api
npx tsx script/test-sponsored-flow.ts
```

This script will:
1. Call the `/prepare` endpoint
2. Sign the UserOperation
3. Submit the signed transaction
4. Wait for confirmation

### 4.2 Run API Tests

```bash
# Run unit tests
npm test

# Run end-to-end tests
npm run test:e2e
```

## Step 5: Development Commands

### For the API (sponsorship-api):
```bash
npm run start:dev      # Start in watch mode for development
npm run build          # Build the application
npm run start:prod     # Start in production mode
npm run lint           # Run linting
npm run test           # Run tests
npm run test:watch     # Run tests in watch mode
```

### For the Frontend (sponsorship-frontend):
```bash
npm run dev            # Start development server
npm run build          # Build for production
npm start              # Start production server
npm run lint           # Run linting
```

## Troubleshooting

### Common Issues

#### 1. Missing Environment Variables
**Error**: `Missing ZERODEV_RPC in .env`
**Solution**: Ensure all required environment variables are set in your `.env` files.

#### 2. Authentication Errors
**Error**: `Missing X-API-KEY` or `Invalid API key`
**Solution**: 
- Ensure the `API_KEY` in your backend `.env` matches the key you're using in requests
- Check that the `X-API-KEY` header is included in your requests

#### 3. RPC Connection Issues
**Error**: Connection timeouts or RPC errors
**Solution**:
- Verify your Alchemy API key is correct and active
- Check that your ZeroDev project ID is correct
- Ensure you have sufficient credits/requests remaining

#### 4. Private Key Issues
**Error**: `AA24 signature error`
**Solution**:
- Ensure your private key is correctly formatted (starts with 0x)
- Verify you're using the correct signer
- Check that the account has been properly initialized

#### 5. Port Conflicts
**Error**: `EADDRINUSE: address already in use`
**Solution**:
- Check if another service is running on the same port
- Kill the process using the port or change the port configuration

### Getting Help

If you encounter issues:

1. Check the console logs for detailed error messages
2. Verify all environment variables are correctly set
3. Ensure your external service accounts (ZeroDev, Alchemy) are properly configured
4. Review the API documentation in `/sponsorship-api/README.md`

## Next Steps

Once you have the system running:

1. **Explore the API**: Review the comprehensive API documentation in the sponsorship-api README
2. **Customize the Frontend**: Modify the Next.js application to suit your needs
3. **Integration**: Use the API endpoints in your own applications
4. **Testing**: Run the provided test scripts to understand the complete flow

## Security Notes

⚠️ **Important Security Considerations**:

- Never commit real private keys or API keys to version control
- Use environment variables for all sensitive configuration
- In production, use proper key management solutions
- Regularly rotate API keys and access tokens
- Monitor your usage of external services to prevent unexpected charges

## Architecture Overview

This system implements:

- **EIP-7702 Account Abstraction** for gasless transactions
- **ZeroDev SDK** for smart account management
- **Paymaster integration** for gas sponsorship
- **Two-phase transaction processing** (prepare → sign → submit)
- **NestJS backend** with proper authentication and validation
- **Next.js frontend** for user interaction

The complete flow is: Frontend → API → ZeroDev → Blockchain