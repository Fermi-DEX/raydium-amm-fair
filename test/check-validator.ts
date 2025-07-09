#!/usr/bin/env ts-node
import { Connection } from '@solana/web3.js';

async function checkValidator() {
  const LOCAL_RPC = 'http://localhost:8899';
  
  try {
    const connection = new Connection(LOCAL_RPC, 'confirmed');
    const version = await connection.getVersion();
    const slot = await connection.getSlot();
    
    console.log("✅ Local validator is running!");
    console.log("Version:", version);
    console.log("Current slot:", slot);
    
    return true;
  } catch (error) {
    console.error("❌ Cannot connect to local validator at", LOCAL_RPC);
    console.error("Make sure to run: solana-test-validator");
    return false;
  }
}

checkValidator();