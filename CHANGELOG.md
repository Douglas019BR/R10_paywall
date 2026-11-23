# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.1.0] - 2026-11-23

### Added

- Manifest V3 extension with a toolbar popup and clean-tab reading modes.
- Generic sanitizer that removes scripts, overlays and hiding styles, rewrites
  relative URLs, and adds a link back to the original article.
- Per-site rules in `rules/sites.json`, including optional User-Agent spoofing.
- Unit tests for the sanitizer and rule matching (`npm test`, 11 tests).
- Before/after screenshots and documentation for contributors.
