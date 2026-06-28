import type { Config } from 'drizzle-kit';
import { join } from 'path';

export default {
  schema: './src/lib/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: join(process.cwd(), 'prisma/dev.db'),
  },
} satisfies Config;
