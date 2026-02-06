# hnsapi

REST + JSON-RPC proxy for an `hsd` backend with Redis caching.

> This was written at Kyokan as the backend for Bob Extension, but is now unmaintained.

## Requirements

- Node.js (ESM)
- Redis
- An `hsd` node with HTTP and RPC enabled

## Install

```sh
npm install
```

## Configuration

Environment variables:

- `BACKEND_URL` (default: `http://x:apikey@127.0.0.1:12037`)
- `REDIS_URL` (default: `redis://localhost:6379`)
- `PORT` (default: `8080`)

## Run

```sh
npm run run
```

For local development:

```sh
npm run dev
```

## API

### REST

REST routes are mounted at `/hsd`. Most requests are proxied directly to the
upstream `hsd` REST API, with caching for block/chain data.

Common endpoints:

- `GET /hsd/`
- `GET /hsd/mempool`
- `GET /hsd/mempool/invalid`
- `GET /hsd/block/:hashOrHeight`
- `GET /hsd/header/:hashOrHeight`
- `POST /hsd/broadcast`
- `POST /hsd/claim`
- `GET /hsd/fee`
- `GET /hsd/coin/:hash/:index`
- `GET /hsd/coin/address/:address`
- `POST /hsd/coin/address`
- `GET /hsd/tx/:hash`
- `GET /hsd/tx/address/:address`
- `POST /hsd/tx/address` (custom: address list + block range)

### JSON-RPC

Send JSON-RPC requests to `POST /hsd`. The handler accepts single or batch
requests. Many methods are proxied directly, while some are disabled for safety.

Custom methods:

- `getbloombyheight`
- `getbloombyheightrange`

See `src/rpc.ts` for the full allowlist and caching rules.

## Tests

```sh
npm test
```
