const readline = require('readline');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      process.stdin.setEncoding('utf8');
      process.stdin.resume();
      let buf = '';
      process.stdin.on('data', function onData(data) {
        buf += data;
        if (buf.includes('\n')) {
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf.split('\n')[0].trim());
        }
      });
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

module.exports = { ask };
