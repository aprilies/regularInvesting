# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Principles

Shame in guessing APIs, Honor in careful research.
Shame in vague execution, Honor in seeking confirmation.
Shame in assuming business logic, Honor in human verification.
Shame in creating interfaces, Honor in reusing existing ones.
Shame in skipping validation, Honor in proactive testing.
Shame in breaking architecture, Honor in following specifications.
Shame in pretending to understand, Honor in honest ignorance.
Shame in blind modification, Honor in careful refactoring.

## Project Overview

**买入决策助手** (Buy Decision Assistant) — A vanilla JS single-page app that analyzes stock buy timing using MA200 deviation, RSI(14), VIX fear index, and drawdown. The entire application (~40KB) lives in `index.html`.

## Commands

- `node test.js` — Run unit tests (IndicatorEngine, ScoringEngine, DataService)
- `node proxy.js` — Start local CORS proxy (port 8787), then open `index.html` directly in browser
- For mobile/production: deploy `api/proxy.js` to Vercel (functions as a serverless CORS proxy)

## Architecture

All logic is embedded in `index.html` under named global modules:

| Module | Responsibility |
|--------|---------------|
| `CONFIG` | Preset tickers, proxy URLs, API endpoints, scoring weights `{ ma200:0.30, rsi:0.25, vix:0.25, drawdown:0.20 }` |
| `DataService` | Fetch/parse from Yahoo Finance, Stooq, AlphaVantage, Sina Finance; normalize all sources to `[{date, open, high, low, close, volume}]` |
| `IndicatorEngine` | `calcSMA(closes, period)`, `calcRSI(closes, period)`, `calcDrawdown(closes)` |
| `ScoringEngine` | Per-indicator scoring functions, `composite(scores)`, `recommend(score)` → `{text, color, bg}` |
| `App` | UI controller: orchestrates fetch → indicator → score → render; handles settings persistence in localStorage |

**Scoring output** (0–100): ≥70 "适合买入" (green), 40–69 "可以买入" (yellow), <40 "建议观望" (red).

## Data Sources

- **Yahoo Finance** (default, recommended): 2-year daily data; requires local proxy in browser
- **Stooq**: CSV format; requires API key and proxy
- **Alpha Vantage**: JSON; requires API key (free tier: 25 req/day)
- **Sina Finance**: Chinese A-shares (sh000001, sz399001, sh510300, etc.) and H-shares

Chinese ticker detection: `sh`/`sz` prefixes, or pure 6-digit numbers map to Sina API.

## Proxy Chain

The app tries proxies in order until one succeeds. In development (`node proxy.js`), browser requests route through `http://localhost:8787`. For production mobile access, `api/proxy.js` is deployed as a Vercel serverless function at `/api/proxy`.

## Testing

`test.js` extracts modules from `index.html` via regex to test business logic standalone. All tests use Node's built-in `assert`. Score boundary conditions are explicitly tested (e.g., RSI=30 → 90, drawdown=0 → 20).