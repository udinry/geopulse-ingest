-- Migrations are never edited after being committed (see CLAUDE.md) — this is a real
-- gap found while building Phase 2, fixed as a new migration rather than rewriting 0001.
--
-- Why this is needed: GDELT's DOC 2.0 API is our source for article title/url/timestamp
-- (the bulk Events/Mentions tables carry NO title field at all — see
-- src/fetch/gdeltDoc.ts's doc comment). Every article ingested through it gets
-- source_id = 'gdelt', because GDELT's own permissive licence is what covers showing a
-- link + headline + timestamp (see docs/ARCHITECTURE.md — this is GDELT's aggregated
-- index, not a redistribution of the original publisher's copyrighted text). But the
-- user-visible byline should read "Reuters" or "AP", not "GDELT" — that display name is
-- a property of the ARTICLE (which publisher wrote it), not of the SOURCE (which feed's
-- licence governs our right to show it at all). Those are two different things and the
-- schema needed a place for the former.

ALTER TABLE articles ADD COLUMN publisher_domain TEXT;
ALTER TABLE articles ADD COLUMN publisher_name TEXT;

CREATE INDEX idx_articles_publisher_domain ON articles (publisher_domain);
