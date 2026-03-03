try {
  const cfonts = (await import('cfonts')).default;
  cfonts.say('AGENTS|WALLETS', {
    font: 'block',
    colors: ['whiteBright'],
    letterSpacing: 0,
    space: false
  });
} catch {
  process.stdout.write('\nAGENTSWALLETS\n');
}

process.stdout.write('\n');
process.stdout.write('Wallets for AI Agents\n');
process.stdout.write('Secure local custody · policy-first transfers · Polymarket\n');
process.stdout.write('\n');
process.stdout.write('Chains: Ethereum · Base · BNB · Polygon · Arbitrum · Solana\n');
process.stdout.write('\n');
process.stdout.write('Get started:\n');
process.stdout.write('  aw init              Initialize data store\n');
process.stdout.write('  aw unlock            Start a session\n');
process.stdout.write('  aw wallet create     Create your first wallet\n');
process.stdout.write('  aw --help            Show all commands\n');
process.stdout.write('\n');
