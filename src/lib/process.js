const { spawn } = require('node:child_process');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(options.timeoutMs) || 0;
    const maxOutputBytes = Number(options.maxOutputBytes) || 32 * 1024 * 1024;
    const useGroup = process.platform !== 'win32';
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env,
      detached: useGroup
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let outputSize = 0;
    let killTimer = null;
    let timer = null;
    let terminating = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const signalChild = (signal) => {
      try {
        if (useGroup && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
        }
      }
    };

    const terminate = () => {
      if (terminating || child.exitCode !== null || child.signalCode !== null) return;
      terminating = true;
      signalChild('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) signalChild('SIGKILL');
      }, 4000);
      killTimer.unref();
    };

    const onAbort = () => {
      aborted = true;
      terminate();
    };

    const drain = (buffer, onLine) => {
      let index = buffer.search(/\r\n|\r|\n/);
      while (index !== -1) {
        const line = buffer.slice(0, index);
        const skip = buffer.startsWith('\r\n', index) ? 2 : 1;
        buffer = buffer.slice(index + skip);
        if (onLine) onLine(line);
        index = buffer.search(/\r\n|\r|\n/);
      }
      return buffer;
    };

    const append = (chunk, stream) => {
      const text = chunk.toString();
      outputSize += Buffer.byteLength(text);
      if (outputSize > maxOutputBytes) {
        terminate();
        return;
      }
      if (stream === 'stdout') {
        stdout += text;
        stdoutBuffer = drain(stdoutBuffer + text, options.onStdoutLine);
      } else {
        stderr += text;
        stderrBuffer = drain(stderrBuffer + text, options.onStderrLine);
      }
    };

    child.stdout.on('data', (chunk) => append(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => append(chunk, 'stderr'));

    child.on('error', (error) => fail(error));

    child.on('close', (code, signal) => {
      if (stdoutBuffer && options.onStdoutLine) options.onStdoutLine(stdoutBuffer);
      if (stderrBuffer && options.onStderrLine) options.onStderrLine(stderrBuffer);
      finish({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        aborted,
        outputLimitExceeded: outputSize > maxOutputBytes
      });
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
      timer.unref();
    }

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

module.exports = { runCommand };
