#!/bin/bash

echo "=== Running Complete Local Test Suite ==="
echo ""
echo "Make sure your local validator is running on http://localhost:8899"
echo ""

# Set up test directory
cd "$(dirname "$0")"

# Install dependencies if needed
echo "1. Installing dependencies..."
cd ../sdk
npm install
cd ../test

# Build the program
echo ""
echo "2. Building Continuum Wrapper..."
cd ../program
cargo build-sbf
cd ../test

# Build the SDK
echo ""
echo "3. Building SDK..."
cd ../sdk
npm run build
cd ../test

# Run setup
echo ""
echo "4. Setting up test environment..."
npx ts-node setup-local.ts

# Create pool
echo ""
echo "5. Creating test pool..."
npx ts-node create-pool.ts

# Deploy wrapper
echo ""
echo "6. Deploying Continuum Wrapper..."
npx ts-node deploy-local.ts

# Test swaps
echo ""
echo "7. Testing FIFO swaps..."
npx ts-node test-fifo-swaps.ts

echo ""
echo "=== All Tests Complete ==="