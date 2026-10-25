import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: { app: 'onebot-companion', version: config.version },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'password',
      'apiKey',
      'token',
      '*.password',
      '*.apiKey',
      '*.token',
      '*.authorization',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
