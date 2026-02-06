import { type Request, type Response } from 'express';
import {
  Backend,
  internalError,
  invalidParams,
  invalidRequest,
  methodNotFound,
} from './client';
import { type Cache } from './cache';
import crypto from 'crypto';
import getHeight from './height';
import BloomFilter, { getBloomSize } from './BloomFilter';
import { uint32LEBuf } from './io';

const COINBASE =
  '0000000000000000000000000000000000000000000000000000000000000000';
const FINALITY_DEPTH = 11;

interface RPCHandler {
  (method: string, params: any[]): Promise<any>;
}

class RPCRegistrar {
  private handlers: { [k: string]: RPCHandler } = {};

  private readonly backend: Backend;

  constructor(backend: Backend) {
    this.backend = backend;
  }

  addHandler(method: string, handler: RPCHandler) {
    this.handlers[method] = handler;
  }

  async handle(req: Request, res: Response) {
    let reqBody = req.body;
    let isBatch = true;
    if (!Array.isArray(reqBody)) {
      isBatch = false;
      reqBody = [reqBody];
    }

    const responses = [];
    for (const body of reqBody) {
      if (typeof body !== 'object') {
        responses.push({
          id: null,
          result: null,
          error: invalidRequest,
        });
        continue;
      }

      if (body.id && typeof body.id === 'object') {
        responses.push({
          id: null,
          result: null,
          error: invalidRequest,
        });
        continue;
      }

      if (typeof body.method !== 'string') {
        responses.push({
          id: body.id,
          result: null,
          error: methodNotFound,
        });
        continue;
      }

      if (!body.params) {
        body.params = [];
      }

      if (!Array.isArray(body.params)) {
        responses.push({
          id: body.id,
          result: null,
          error: invalidParams,
        });
        continue;
      }

      if (!this.handlers[body.method]) {
        responses.push({
          id: body.id,
          result: null,
          error: methodNotFound,
        });
        continue;
      }

      try {
        const result = await this.handlers[body.method](
          body.method,
          body.params,
        );
        responses.push({
          id: body.id,
          result,
          error: null,
        });
      } catch (e: any) {
        let error = internalError;
        if (e instanceof RPCError) {
          e = e as RPCError;
          error = {
            message: e.message,
            code: e.code,
          };
        }
        responses.push({
          id: body.id,
          result: null,
          error,
        });
      }
    }

    if (!isBatch) {
      res.json(responses[0]);
      return;
    }
    res.json(responses);
  }
}

class RPCError extends Error {
  private code: number;

  constructor(params: { message: string; code: number }) {
    super(params.message);
    this.code = params.code;
  }
}

async function disabledRPCHandler(method: string, params: any[]) {
  throw new RPCError({
    message: 'RPC method is disabled.',
    code: -32000,
  });
}

function directRPCHandler(backend: Backend): RPCHandler {
  return async (method, params) => {
    const rpcRes = await backend.execRpc(method, params);
    if (rpcRes.error) {
      throw new RPCError(rpcRes.error);
    }
    return rpcRes.result;
  };
}

function blockExpiringRPCHandler(
  backend: Backend,
  cache: Cache,
  expiry: number = 15 * 60,
): RPCHandler {
  return async (method, params) => {
    const height = await getHeight(backend, cache);
    const ck = `rpc/${height}/${method}/${hashParams(params)}`;
    return doCachedRPC(backend, cache, method, params, ck, expiry);
  };
}

function timedRPCHandler(
  backend: Backend,
  cache: Cache,
  expiry: number = 15,
): RPCHandler {
  return async (method, params) => {
    const ck = `rpc/${method}/${hashParams(params)}`;
    return doCachedRPC(backend, cache, method, params, ck, expiry);
  };
}

async function getBlockByHeight(
  backend: Backend,
  cache: Cache,
  reqHeight: number,
): Promise<any> {
  const chainHeight = await getHeight(backend, cache);
  const params = [reqHeight, 1, 1];
  let ck;
  if (chainHeight - reqHeight > FINALITY_DEPTH) {
    ck = `rpc/perm/getblockbyheight/${hashParams(params)}`;
  } else {
    ck = `rpc/${chainHeight}/getblockbyheight/${hashParams(params)}`;
  }
  return doCachedRPC(backend, cache, 'getblockbyheight', params, ck, 15 * 60);
}

async function doCachedRPC(
  backend: Backend,
  cache: Cache,
  method: string,
  params: any[],
  ck: string,
  expiry: number,
): Promise<any> {
  const cached = await cache.getKey(ck);
  if (cached) {
    return cached;
  }

  const rpcRes = await backend.execRpc(method, params);
  if (rpcRes.error) {
    throw new RPCError(rpcRes.error);
  }

  if (rpcRes.result !== null) {
    await cache.setKey(ck, rpcRes.result, expiry);
  }

  return rpcRes.result;
}

async function getAddressBloom(backend: Backend, cache: Cache, height: number) {
  if (!Number.isInteger(height)) {
    throw new RPCError(invalidParams);
  }

  const chainHeight = await getHeight(backend, cache);
  let ck;
  let expiry;
  if (chainHeight - height >= FINALITY_DEPTH) {
    ck = `rpc/perm/getaddressbloom/${hashParams([height])}`;
    expiry = 24 * 60 * 60;
  } else {
    ck = `rpc/${chainHeight}/getaddressbloom/${hashParams([height])}`;
    expiry = 15 * 60;
  }
  const cached = await cache.getKey(ck);
  if (cached) {
    return cached;
  }

  const block = await getBlockByHeight(backend, cache, height);
  const { m, k } = getBloomSize(block.tx.length);
  const addrBloom = new BloomFilter(m, k);
  const outBloom = new BloomFilter(m, k);
  for (const tx of block.tx) {
    for (const vin of tx.vin) {
      if (vin.txid === COINBASE) {
        continue;
      }

      outBloom.add(
        Buffer.concat([Buffer.from(vin.txid, 'hex'), uint32LEBuf(vin.vout)]),
      );
    }

    for (const vout of tx.vout) {
      addrBloom.add(
        Buffer.concat([
          Buffer.from(vout.address.hash, 'hex'),
          Buffer.from([vout.address.version]),
        ]),
      );
    }
  }

  const result = {
    height,
    addressBloom: addrBloom.toBuffer().toString('hex'),
    outpointBloom: outBloom.toBuffer().toString('hex'),
  };
  await cache.setKey(ck, result, expiry);
  return result;
}

function addressBloomHandler(backend: Backend, cache: Cache): RPCHandler {
  return async (method, params) => {
    if (params.length < 1) {
      throw new RPCError({
        message: 'Must specify at least one block height.',
        code: invalidParams.code,
      });
    }
    if (params.length > 100) {
      throw new RPCError({
        message: 'Cannot specify more than 100 block heights.',
        code: invalidParams.code,
      });
    }

    const chainHeight = await getHeight(backend, cache);

    const blooms = [];
    for (const height of params) {
      if (typeof height !== 'number' || height < 0) {
        continue;
      }
      if (height > chainHeight) {
        continue;
      }
      blooms.push(await getAddressBloom(backend, cache, height));
    }
    return blooms;
  };
}

function addressBloomByRangeHandler(
  backend: Backend,
  cache: Cache,
): RPCHandler {
  return async (method, params) => {
    if (params.length !== 2) {
      throw new RPCError({
        message: 'Must specify a start and end block height.',
        code: invalidParams.code,
      });
    }

    const [start, end] = params;

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new RPCError({
        message: 'Start and end must be integers.',
        code: invalidParams.code,
      });
    }
    if (end - start > 100) {
      throw new RPCError({
        message: 'Cannot specify a ranger larger than 100 blocks.',
        code: invalidParams.code,
      });
    }
    if (start >= end) {
      throw new RPCError({
        message: 'Start must come before end.',
        code: invalidParams.code,
      });
    }
    if (start < 0) {
      throw new RPCError({
        message: 'Start cannot be negative.',
        code: invalidParams.code,
      });
    }

    const chainHeight = await getHeight(backend, cache);
    if (end > chainHeight) {
      throw new RPCError({
        message: 'End cannot be higher than the chain height.',
        code: invalidParams.code,
      });
    }

    const blooms = [];
    for (let i = start; i <= end; i++) {
      blooms.push(await getAddressBloom(backend, cache, i));
    }
    return blooms;
  };
}

function hashParams(params: any): string {
  const hash = crypto.createHash('md5');
  hash.update(JSON.stringify(params));
  return hash.digest().toString('hex');
}

export function rpcRouter(
  backend: Backend,
  cache: Cache,
): (req: Request, res: Response) => void {
  const registrar = new RPCRegistrar(backend);
  const directRPC = directRPCHandler(backend);
  const blockCacheRPC = blockExpiringRPCHandler(backend, cache);

  // standard RPC handlers
  registrar.addHandler('stop', disabledRPCHandler);
  registrar.addHandler('getinfo', blockCacheRPC);
  registrar.addHandler('getmemoryinfo', disabledRPCHandler);
  registrar.addHandler('setloglevel', disabledRPCHandler);
  registrar.addHandler('validateaddress', directRPC);
  registrar.addHandler('createmultisig', disabledRPCHandler);
  registrar.addHandler('signmessagewithprivkey', disabledRPCHandler);
  registrar.addHandler('verifymessage', directRPC);
  registrar.addHandler('verifymessagewithname', directRPC);
  registrar.addHandler('setmocktime', disabledRPCHandler);
  registrar.addHandler('pruneblockchain', disabledRPCHandler);
  registrar.addHandler('invalidateblock', disabledRPCHandler);
  registrar.addHandler('reconsiderblock', disabledRPCHandler);
  registrar.addHandler('getblockchaininfo', blockCacheRPC);
  registrar.addHandler('getbestblockhash', blockCacheRPC);
  registrar.addHandler('getblockcount', blockCacheRPC);
  registrar.addHandler('getblock', blockCacheRPC);
  registrar.addHandler('getblockbyheight', blockCacheRPC);
  registrar.addHandler('getblockhash', blockCacheRPC);
  registrar.addHandler('getblockheader', blockCacheRPC);
  registrar.addHandler('getchaintips', blockCacheRPC);
  registrar.addHandler('getdifficulty', timedRPCHandler(backend, cache, 120));
  registrar.addHandler(
    'getmempoolinfo',
    blockExpiringRPCHandler(backend, cache, 10),
  );
  registrar.addHandler('getmempoolancestors', directRPC);
  registrar.addHandler('getmempooldescendants', directRPC);
  registrar.addHandler('getmempoolentry', timedRPCHandler(backend, cache, 120));
  registrar.addHandler('getrawmempool', directRPCHandler(backend));
  registrar.addHandler('prioritisetransaction', disabledRPCHandler);
  registrar.addHandler('estimatefee', timedRPCHandler(backend, cache, 30 * 60));
  registrar.addHandler('estimatepriority', directRPC);
  registrar.addHandler('estimatesmartfee', directRPC);
  registrar.addHandler('estimatesmartpriority', directRPC);
  registrar.addHandler('gettxout', blockCacheRPC);
  registrar.addHandler('gettxoutsetinfo', blockCacheRPC);
  registrar.addHandler('getrawtransaction', blockCacheRPC);
  registrar.addHandler('decoderawtransaction', directRPC);
  registrar.addHandler('decodescript', directRPC);
  registrar.addHandler('sendrawtransaction', directRPC);
  registrar.addHandler('createrawtransaction', disabledRPCHandler);
  registrar.addHandler('signrawtransaction', disabledRPCHandler);
  registrar.addHandler('gettxoutsetproof', directRPC);
  registrar.addHandler('verifytxoutproof', directRPC);
  registrar.addHandler('getnetworkhashps', directRPC);
  registrar.addHandler('getmininginfo', directRPC);
  registrar.addHandler('getwork', disabledRPCHandler);
  registrar.addHandler('getworklp', disabledRPCHandler);
  registrar.addHandler('getblocktemplate', disabledRPCHandler);
  registrar.addHandler('submitblock', disabledRPCHandler);
  registrar.addHandler('verifyblock', directRPC);
  registrar.addHandler('setgenerate', disabledRPCHandler);
  registrar.addHandler('getgenerate', disabledRPCHandler);
  registrar.addHandler('generate', disabledRPCHandler);
  registrar.addHandler('generatetoaddress', disabledRPCHandler);
  registrar.addHandler('getconnectioncount', disabledRPCHandler);
  registrar.addHandler('ping', disabledRPCHandler);
  registrar.addHandler('getpeerinfo', disabledRPCHandler);
  registrar.addHandler('addnode', disabledRPCHandler);
  registrar.addHandler('disconnectnode', disabledRPCHandler);
  registrar.addHandler('getaddednodeinfo', disabledRPCHandler);
  registrar.addHandler('getnettotals', disabledRPCHandler);
  registrar.addHandler('getnetworkinfo', disabledRPCHandler);
  registrar.addHandler('setban', disabledRPCHandler);
  registrar.addHandler('clearbanned', disabledRPCHandler);
  registrar.addHandler('getnameinfo', blockCacheRPC);
  registrar.addHandler('getnames', disabledRPCHandler);
  registrar.addHandler(
    'getnamebyhash',
    timedRPCHandler(backend, cache, 60 * 60),
  );
  registrar.addHandler('getnameresource', blockCacheRPC);
  registrar.addHandler('getnameproof', blockCacheRPC);
  registrar.addHandler('createclaim', directRPC);
  registrar.addHandler('sendclaim', directRPC);
  registrar.addHandler('sendrawclaim', directRPC);
  registrar.addHandler('getdnssecproof', blockCacheRPC);
  registrar.addHandler('sendrawairdrop', directRPC);
  registrar.addHandler('grindname', disabledRPCHandler);

  // custom RPC handlers
  registrar.addHandler('getbloombyheight', addressBloomHandler(backend, cache));
  registrar.addHandler(
    'getbloombyheightrange',
    addressBloomByRangeHandler(backend, cache),
  );

  return (req, res) => registrar.handle(req, res);
}

export default rpcRouter;
