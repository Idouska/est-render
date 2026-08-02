import { pino } from 'pino';
import { env } from '../config/env.ts';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Les mails clients contiennent des données personnelles : on ne loggue
  // jamais de corps de message, et on masque tout ce qui ressemble à un secret.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'accessToken',
      'refreshToken',
      '*.accessTokenEnc',
      '*.refreshTokenEnc',
      'bodyText',
      '*.bodyText',
    ],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
