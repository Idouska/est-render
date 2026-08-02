import { logger } from './lib/logger.ts';
import { disconnectPrisma } from './lib/prisma.ts';
import { closeQueues } from './queue/index.ts';
import { startServer } from './server.ts';

const app = await startServer();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Arrêt de l’API');
  await app.close();
  await closeQueues();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
