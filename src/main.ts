import pino from 'pino';

const log = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

log.info('emoji-decryption scaffold: ok');
