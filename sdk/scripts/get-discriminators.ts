#!/usr/bin/env ts-node
import { createHash } from 'crypto';

function getDiscriminator(namespace: string, name: string): Buffer {
  const preimage = `${namespace}:${name}`;
  const hash = createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

// Calculate discriminators for our instructions
const instructions = [
  { namespace: 'global', name: 'initialize' },
  { namespace: 'global', name: 'swap_with_seq' }
];

console.log("Instruction Discriminators:\n");

instructions.forEach(({ namespace, name }) => {
  const discriminator = getDiscriminator(namespace, name);
  console.log(`${name}:`);
  console.log(`  Hex: ${discriminator.toString('hex')}`);
  console.log(`  Buffer: [${Array.from(discriminator).join(', ')}]`);
  console.log(`  Preimage: "${namespace}:${name}"`);
  console.log();
});

// Also try with potential Anchor naming conventions
console.log("Potential Anchor discriminators:\n");

const anchorInstructions = [
  'initialize',
  'swapWithSeq',
  'swap_with_seq'
];

anchorInstructions.forEach(name => {
  const discriminator = getDiscriminator('global', name);
  console.log(`${name}:`);
  console.log(`  Hex: ${discriminator.toString('hex')}`);
  console.log(`  Buffer: [${Array.from(discriminator).join(', ')}]`);
  console.log();
});