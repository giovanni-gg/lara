-- CreateEnum
CREATE TYPE "CardJobStatus" AS ENUM ('QUEUED', 'WRITING', 'AUDIO', 'PICTURES', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "CardJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "deckId" TEXT,
    "deckName" TEXT,
    "prompt" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "direction" "CardDirection",
    "status" "CardJobStatus" NOT NULL DEFAULT 'QUEUED',
    "done" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardJob_userId_createdAt_idx" ON "CardJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CardJob" ADD CONSTRAINT "CardJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardJob" ADD CONSTRAINT "CardJob_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LanguageProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardJob" ADD CONSTRAINT "CardJob_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
