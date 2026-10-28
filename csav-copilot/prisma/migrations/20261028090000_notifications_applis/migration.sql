-- Les notifications d'applis, rangées hors de la file.
ALTER TABLE "Ticket" ADD COLUMN "notification" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN "notificationMotif" TEXT;
ALTER TABLE "Merchant" ADD COLUMN "expediteursNotif" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Merchant" ADD COLUMN "expediteursClients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Le courrier déjà entré : seuls les expéditeurs sans ambiguïté — adresse de
-- robot ou appli connue — et seulement les fils auxquels personne n'a jamais
-- répondu. Mêmes règles que `services/tickets/notification.ts`, sans les
-- en-têtes, que la base n'a pas gardés.
UPDATE "Ticket" t
SET "notification" = true,
    "notificationMotif" = CASE
      WHEN t."customerEmail" ~* '^[^@]*(no-?reply|do-?not-?reply|ne-?pas-?repondre|nepasrepondre|mailer-daemon|postmaster|bounces?|notifications?|newsletters?)[^@]*@'
        THEN 'Adresse d’envoi automatique'
      ELSE 'Appli : ' || lower(split_part(t."customerEmail", '@', 2))
    END
WHERE t."isHistorical" = false
  AND t."gmailThreadId" NOT LIKE 'supplier:%'
  AND coalesce(t."subject", '') !~* '(formulaire de contact|contact form|customer message|message (d''un |du )?client|litige|dispute|chargeback|rétrofacturation|opposition)'
  AND (
    t."customerEmail" ~* '^[^@]*(no-?reply|do-?not-?reply|ne-?pas-?repondre|nepasrepondre|mailer-daemon|postmaster|bounces?|notifications?|newsletters?)[^@]*@'
    OR lower(split_part(t."customerEmail", '@', 2)) ~ '(^|\.)(judge\.me|shopify\.com|shopifyemail\.com|klaviyo\.com|klaviyomail\.com|mailchimp\.com|mcsv\.net|facebookmail\.com|meta\.com|instagram\.com|tiktok\.com|google\.com|youtube\.com|linkedin\.com|canva\.com|trustpilot\.com|17track\.net|aftership\.com)$'
  )
  AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."ticketId" = t.id AND m."direction" = 'OUTBOUND');

CREATE INDEX "Ticket_merchantId_notification_idx" ON "Ticket"("merchantId", "notification");
