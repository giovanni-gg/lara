-- DropIndex
DROP INDEX "Card_ankiId_key";

-- DropIndex
DROP INDEX "Review_ankiId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Card_userId_ankiId_key" ON "Card"("userId", "ankiId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_ankiId_key" ON "Review"("userId", "ankiId");
