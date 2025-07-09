#!/bin/bash

echo "Building Continuum Wrapper..."
cd program
cargo build-sbf
cd ..

echo "Building TypeScript SDK..."
cd sdk
npm install
npm run build
cd ..

echo "Build complete!"
echo ""
echo "Next steps:"
echo "1. Deploy: cd sdk && npm run deploy"
echo "2. Initialize: cd sdk && npm run init"
echo "3. Test: cd sdk && npm run test-swap"