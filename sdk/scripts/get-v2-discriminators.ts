import { createHash } from 'crypto';

function getDiscriminator(namespace: string, name: string): Buffer {
    const preimage = `${namespace}:${name}`;
    const hash = createHash('sha256').update(preimage).digest();
    return hash.slice(0, 8);
}

// Calculate discriminators for v2 instructions
const instructions = [
    { name: 'initialize', namespace: 'global' },
    { name: 'initialize_pool_authority', namespace: 'global' },
    { name: 'swap_with_pool_authority', namespace: 'global' },
    { name: 'create_pool_with_authority', namespace: 'global' },
];

console.log('V2 Instruction Discriminators:\n');

instructions.forEach(({ name, namespace }) => {
    const discriminator = getDiscriminator(namespace, name);
    console.log(`${name}:`);
    console.log(`  Hex: ${discriminator.toString('hex')}`);
    console.log(`  Buffer: [${Array.from(discriminator).join(', ')}]`);
    console.log(`  Preimage: "${namespace}:${name}"`);
    console.log();
});

// Also try camelCase versions
console.log('CamelCase versions:\n');

const camelCaseNames = [
    'initializePoolAuthority',
    'swapWithPoolAuthority',
    'createPoolWithAuthority',
];

camelCaseNames.forEach((name) => {
    const discriminator = getDiscriminator('global', name);
    console.log(`${name}:`);
    console.log(`  Hex: ${discriminator.toString('hex')}`);
    console.log(`  Buffer: [${Array.from(discriminator).join(', ')}]`);
    console.log();
});