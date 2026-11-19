-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "deckId" TEXT;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
