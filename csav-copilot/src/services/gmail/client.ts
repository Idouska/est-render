import { google, type gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { env, googleRedirectUri } from '../../config/env.ts';
import { decryptSecret, encryptSecret } from '../../lib/crypto.ts';
import { prisma } from '../../lib/prisma.ts';

export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, googleRedirectUri);
}

export class GmailNotConnectedError extends Error {
  constructor(merchantId: string) {
    super(`Aucune boîte Gmail connectée pour le marchand ${merchantId}`);
    this.name = 'GmailNotConnectedError';
  }
}

/**
 * Client Gmail scopé à un marchand. Le refresh token reste chiffré en base ;
 * la librairie Google rafraîchit l'access token, qu'on re-chiffre au passage.
 */
export async function getGmailClient(merchantId: string): Promise<{
  gmail: gmail_v1.Gmail;
  emailAddress: string;
}> {
  const connection = await prisma.gmailConnection.findUnique({ where: { merchantId } });

  if (!connection) {
    throw new GmailNotConnectedError(merchantId);
  }

  const auth = createOAuthClient();
  auth.setCredentials({
    refresh_token: decryptSecret(connection.refreshTokenEnc),
    access_token: connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : undefined,
    expiry_date: connection.accessTokenExpiresAt?.getTime(),
  });

  auth.on('tokens', (tokens) => {
    if (!tokens.access_token) return;
    // Persistance best-effort : un échec ici ne doit pas casser la requête en cours.
    void prisma.gmailConnection
      .update({
        where: { merchantId },
        data: {
          accessTokenEnc: encryptSecret(tokens.access_token),
          accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          ...(tokens.refresh_token
            ? { refreshTokenEnc: encryptSecret(tokens.refresh_token) }
            : {}),
        },
      })
      .catch(() => undefined);
  });

  return {
    gmail: google.gmail({ version: 'v1', auth }),
    emailAddress: connection.emailAddress,
  };
}
