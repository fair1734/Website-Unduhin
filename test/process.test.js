const test = require('node:test');
const assert = require('node:assert/strict');
const { runCommand } = require('../src/lib/process');

test('menjalankan proses dan memisahkan baris dengan CR atau LF', async () => {
  const stdoutLines = [];
  const stderrLines = [];
  const result = await runCommand(process.execPath, [
    '-e',
    "process.stdout.write('satu\\rdua\\ntiga\\n');process.stderr.write('galat\\r')"
  ], {
    timeoutMs: 10000,
    onStdoutLine: (line) => stdoutLines.push(line),
    onStderrLine: (line) => stderrLines.push(line)
  });

  assert.equal(result.code, 0);
  assert.deepEqual(stdoutLines, ['satu', 'dua', 'tiga']);
  assert.deepEqual(stderrLines, ['galat']);
  assert.equal(result.stdout, 'satu\rdua\ntiga\n');
});

test('menandai proses yang melewati batas waktu', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], {
    timeoutMs: 100
  });
  assert.equal(result.timedOut, true);
});
