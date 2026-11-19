-- CreateTable
CREATE TABLE "SpeakConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "deckId" TEXT,
    "topic" TEXT NOT NULL,
    "externalId" TEXT,
    "transcript" JSONB NOT NULL,
    "corrections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeakConversation_profileId_createdAt_idx" ON "SpeakConversation"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "SpeakConversation" ADD CONSTRAINT "SpeakConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakConversation" ADD CONSTRAINT "SpeakConversation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LanguageProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakConversation" ADD CONSTRAINT "SpeakConversation_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
