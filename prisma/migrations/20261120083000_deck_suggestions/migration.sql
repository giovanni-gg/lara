-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "suggestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "suggestionsCardCount" INTEGER;
