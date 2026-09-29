import app from './api.js';

const port = Number(process.env.API_PORT || process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Configured API port must be an integer between 1024 and 65535.');
}

app.listen(port, '0.0.0.0', () => {
  console.info(`Recall API listening on 0.0.0.0:${port}`);
});
