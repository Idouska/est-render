-- Signature des mails sortants. Un message de service sans signature se lit
-- comme une notification de robot, et les filtres le classent comme telle.

ALTER TABLE "Merchant" ADD COLUMN "emailSignature" TEXT;
