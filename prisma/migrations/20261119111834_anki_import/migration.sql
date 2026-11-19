-- CreateEnum
CREATE TYPE "CardDirection" AS ENUM ('RECOGNITION', 'PRODUCTION', 'BOTH');

-- AlterEnum
ALTER TYPE "CardType" ADD VALUE 'PICTURE';

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "ankiId" BIGINT;

-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "ankiId" BIGINT,
ADD COLUMN     "direction" "CardDirection" NOT NULL DEFAULT 'RECOGNITION';

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "ankiId" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "Card_ankiId_key" ON "Card"("ankiId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_ankiId_key" ON "Review"("ankiId");
