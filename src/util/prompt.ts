import readline from 'node:readline';

export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve, reject) => {
    rl.on('close', () => reject(new Error('stdin closed before input was received')));
    rl.question(question, (answer) => {
      rl.removeAllListeners('close');
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

  return new Promise((resolve, reject) => {
    let input = '';
    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('close', onEnd);
      process.stdin.removeListener('error', onError);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('stdin closed before input was received'));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onData = (char: string) => {
      const c = char.toString();
      if (c === '\n' || c === '\r' || c === '\u0004') {
        cleanup();
        process.stderr.write('\n');
        resolve(input.trim());
        return;
      }
      if (c === '\u0003') {
        cleanup();
        process.exit(130);
      }
      if (c === '\u007f') {
        input = input.slice(0, -1);
        return;
      }
      input += c;
    };
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('close', onEnd);
    process.stdin.on('error', onError);
  });
}
