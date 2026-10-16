-- Les photos qu'un atelier joint à un signalement : aucun mail derrière, donc
-- rien chez Gmail. Le contenu vit avec la pièce jointe.
ALTER TABLE "Attachment" ALTER COLUMN "gmailAttachmentId" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN "data" BYTEA;
