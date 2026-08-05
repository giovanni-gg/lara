-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('RECOGNITION', 'PRODUCTION', 'CLOZE', 'TYPING');

-- CreateEnum
CREATE TYPE "FsrsState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LanguageProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL DEFAULT 'en',
    "level" "CefrLevel" NOT NULL DEFAULT 'A1',
    "dailyNewLimit" INTEGER NOT NULL DEFAULT 20,
    "dailyReviewLimit" INTEGER NOT NULL DEFAULT 200,
    "voiceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LanguageProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourcePrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "targetSentence" TEXT,
    "sourceSentence" TEXT,
    "notes" TEXT,
    "cardType" "CardType" NOT NULL DEFAULT 'RECOGNITION',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageUrl" TEXT,
    "audioUrl" TEXT,
    "sentenceAudioUrl" TEXT,
    "state" "FsrsState" NOT NULL DEFAULT 'NEW',
    "due" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elapsedDays" INTEGER NOT NULL DEFAULT 0,
    "scheduledDays" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "learningSteps" INTEGER NOT NULL DEFAULT 0,
    "lastReview" TIMESTAMP(3),
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "state" "FsrsState" NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "elapsedDays" INTEGER NOT NULL,
    "lastElapsedDays" INTEGER NOT NULL,
    "scheduledDays" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleTranslated" TEXT,
    "topic" TEXT,
    "level" "CefrLevel" NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "audioUrl" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "reusedVocabulary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "newVocabulary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourcePrompt" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleSegment" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "target" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "audioUrl" TEXT,

    CONSTRAINT "ArticleSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "LanguageProfile_userId_idx" ON "LanguageProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LanguageProfile_userId_targetLanguage_key" ON "LanguageProfile"("userId", "targetLanguage");

-- CreateIndex
CREATE INDEX "Deck_userId_idx" ON "Deck"("userId");

-- CreateIndex
CREATE INDEX "Deck_profileId_idx" ON "Deck"("profileId");

-- CreateIndex
CREATE INDEX "Card_deckId_due_idx" ON "Card"("deckId", "due");

-- CreateIndex
CREATE INDEX "Card_userId_due_idx" ON "Card"("userId", "due");

-- CreateIndex
CREATE INDEX "Card_deckId_state_idx" ON "Card"("deckId", "state");

-- CreateIndex
CREATE INDEX "Review_userId_reviewedAt_idx" ON "Review"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "Review_cardId_reviewedAt_idx" ON "Review"("cardId", "reviewedAt");

-- CreateIndex
CREATE INDEX "Article_userId_createdAt_idx" ON "Article"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Article_profileId_idx" ON "Article"("profileId");

-- CreateIndex
CREATE INDEX "ArticleSegment_articleId_idx" ON "ArticleSegment"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleSegment_articleId_index_key" ON "ArticleSegment"("articleId", "index");

-- AddForeignKey
ALTER TABLE "LanguageProfile" ADD CONSTRAINT "LanguageProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LanguageProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LanguageProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSegment" ADD CONSTRAINT "ArticleSegment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
