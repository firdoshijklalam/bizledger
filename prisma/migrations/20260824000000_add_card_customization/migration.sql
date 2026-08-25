-- Add coverUrl to Business for card background photo
ALTER TABLE "Business" ADD COLUMN "coverUrl" TEXT;

-- Add cardPreferences to AppSettings for card visibility preferences (JSON string)
ALTER TABLE "AppSettings" ADD COLUMN "cardPreferences" TEXT;
