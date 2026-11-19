-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Deck_parentId_idx" ON "Deck"("parentId");

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
