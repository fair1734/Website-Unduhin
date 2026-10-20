const http = require('node:http');
const app = require('./app');
const config = require('./config');
const jobs = require('./services/jobs');

async function start() {
  await jobs.init();

  const server = http.createServer(app);
  server.requestTimeout = 0;
  server.headersTimeout = 65000;
  server.keepAliveTimeout = 61000;

  server.on('error', (error) => {
    console.error(`Server gagal berjalan: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(config.port, config.host, () => {
    console.log(`Unduhin aktif di ${config.siteAddress} (${config.host}:${config.port})`);
  });

  const shutdown = (signal) => {
    console.log(`Menerima ${signal}, menutup server...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
