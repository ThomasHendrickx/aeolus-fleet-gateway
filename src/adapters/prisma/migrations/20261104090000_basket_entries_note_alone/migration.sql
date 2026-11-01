-- A basket entry may answer with a note alone, with no option.
ALTER TABLE "basket_entries" ALTER COLUMN "option" DROP NOT NULL;
