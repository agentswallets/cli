import readline from 'node:readline';

export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function askHidden(question: string): Promise<string> {
  process.stderr.write(question);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let input = '';
    const onData = (char: string) => {
      const c = char.toString();
      if (c === '\n' || c === '\r' || c === '\u0004') {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(input.trim());
        return;
      }
      if (c === '\u0003') {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.exit(130);
      }
      if (c === '\u007f') {
        input = input.slice(0, -1);
        return;
      }
      input += c;
    };
    process.stdin.on('data', onData);
  });
}
