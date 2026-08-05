-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('ARTICLE', 'STORY');

-- DropIndex
DROP INDEX "Article_profileId_idx";

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "kind" "ContentKind" NOT NULL DEFAULT 'ARTICLE';

-- CreateTable
CREATE TABLE "CardChatMessage" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardChatMessage_cardId_createdAt_idx" ON "CardChatMessage"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "Article_profileId_kind_idx" ON "Article"("profileId", "kind");

-- AddForeignKey
ALTER TABLE "CardChatMessage" ADD CONSTRAINT "CardChatMessage_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardChatMessage" ADD CONSTRAINT "CardChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
