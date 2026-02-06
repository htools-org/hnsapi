import {Backend} from './client';
import express, {Request, Response, Router} from 'express';
import getHeight from './height';
import {Cache} from './cache';

interface RESTHandler {
  (req: Request, res: Response): void
}

function identity (data: any): any {
  return data;
}

function directGetHandler (backend: Backend, postProcess?: (data: any) => void): RESTHandler {
  return async (req, res) => {
    try {
      const bRes = await backend.doGet(req.path);
      if (!postProcess) {
        postProcess = identity;
      }
      return res.json(postProcess(bRes.data));
    } catch (e) {
      handleError(e, req, res);
    }
  };
}

function directPostHandler (backend: Backend, postProcess?: (data: any) => void): RESTHandler {
  return async (req, res) => {
    try {
      const bRes = await backend.doPost(req.path, req.body);
      if (!postProcess) {
        postProcess = identity;
      }
      return res.json(postProcess(bRes.data));
    } catch (e) {
      handleError(e, req, res);
    }
  };
}

function blockExpiringGetHandler (backend: Backend, cache: Cache, postProcess?: (data: any) => void, expiry?: number): RESTHandler {
  return async (req, res) => {
    const height = await getHeight(backend, cache);

    const ck = `rpc/${height}/${req.path}`;
    const cached = await cache.getKey(ck);
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const bRes = await backend.doGet(req.path);
      if (!postProcess) {
        postProcess = identity;
      }
      const data = postProcess(bRes.data);
      await cache.setKey(ck, data, expiry || 30 * 60);
      res.json(data);
    } catch (e) {
      handleError(e, req, res);
    }
  };
}

function getTXByAddressesHandler (backend: Backend): RESTHandler {
  return async (req, res) => {
    let {addresses, startBlock, endBlock} = req.body;
    if (!addresses || !addresses.length) {
      res.status(400);
      return res.json({
        message: 'Must specify a list of addresses.'
      });
    }

    if (addresses.length > 10000) {
      res.status(400);
      return res.json({
        message: 'Cannot specify more than 1500 addresses.'
      });
    }


    if (typeof startBlock === 'undefined' || typeof endBlock === 'undefined') {
      res.status(400);
      return res.json({
        message: 'Must specify start and end blocks.'
      });
    }

    startBlock = Number(startBlock);
    endBlock = Number(endBlock);

    if (isNaN(startBlock) || isNaN(endBlock)) {
      res.status(400);
      return res.json({
        message: 'Must specify numeric start and end blocks.'
      });
    }

    if (startBlock > endBlock) {
      res.status(400);
      return res.json({
        message: 'Start block must be before end block.'
      });
    }

    if (endBlock - startBlock + 1 > 250) {
      res.status(400);
      return res.json({
        message: 'Cannot specify a block range of more than 250 blocks.'
      });
    }

    //

    const out = (await backend.doPost(req.path, req.body)).data as object[];

    //

    // const addrSet = new Set(addresses);
    // const out = [];
    // for (let i = startBlock; i <= endBlock; i++) {
    //   const block = await diskStore.getRESTBlockByHeight(i);
    //   if (!block) {
    //     break;
    //   }

    //   for (const tx of block.txs) {
    //     let hasInput = false;
    //     for (const input of tx.inputs) {
    //       if (!input.coin) {
    //         continue;
    //       }

    //       if (addrSet.has(input.coin.address)) {
    //         out.push({
    //           ...tx,
    //           height: block.height,
    //           time: block.time,
    //           block: block.hash,
    //         });
    //         hasInput = true;
    //         break;
    //       }
    //     }

    //     if (hasInput) {
    //       break;
    //     }

    //     for (const output of tx.outputs) {
    //       if (addrSet.has(output.address)) {
    //         out.push({
    //           ...tx,
    //           height: block.height,
    //           time: block.time,
    //           block: block.hash,
    //         });
    //         break;
    //       }
    //     }
    //   }
    // }

    res.json({
      startBlock: startBlock,
      endBlock: endBlock,
      txs: out
    });
  };
}

function timedGetHandler(backend: Backend, cache: Cache, expiry: number): RESTHandler {
  return async (req, res) => {

  }
}

function disabledHandler (req: Request, res: Response) {
  res.status(403);
  res.json({
    message: 'Forbidden.'
  });
}


function handleError (e: any, req: Request, res: Response) {
  if (e.response) {
    res.status(e.response.status);
    return res.json(e.response.status);
  }

  if (e.request) {
    res.status(503);
    return res.json({
      message: 'Internal error.'
    });
  }

  res.status(500);
  return res.json({
    message: 'Unknown error.'
  });
}

export function restRouter (backend: Backend, cache: Cache): Router {
  const router = express.Router();
  router.get('/', blockExpiringGetHandler(backend, cache, (data) => {
    data.pool = {
      ...data.pool,
      host: '0.0.0.0',
      identitykey: '',
      outbound: 0,
      inbound: 0,
    };
    data.time.uptime = 0;
    data.memory = {
      total: 0,
      jsHeap: 0,
      jsHeapTotal: 0,
      external: 0,
    };
    return data;
  }));
  router.get('/mempool', directGetHandler(backend));
  router.get('/mempool/invalid', directGetHandler(backend));
  router.get('/mempool/invalid/:hash([0-9a-f]{64})', directGetHandler(backend));
  router.get('/block/:hashOrHeight([0-9a-f]{64}|[0-9]+)', blockExpiringGetHandler(backend, cache));
  router.get('/header/:hashOrHeight([0-9a-f]{64}|[0-9]+)', blockExpiringGetHandler(backend, cache));
  router.post('/broadcast', directPostHandler(backend));
  router.post('/claim', directPostHandler(backend));
  router.get('/fee', directGetHandler(backend));
  router.post('/reset', disabledHandler);
  router.get('/coin/:hash([0-9a-f]{64})/:index([0-9]+)', blockExpiringGetHandler(backend, cache));
  router.get('/coin/address/:address', blockExpiringGetHandler(backend, cache));
  router.post('/coin/address', directPostHandler(backend));
  router.get('/tx/:hash([0-9a-f]{64})', blockExpiringGetHandler(backend, cache));
  router.get('/tx/address/:address', directGetHandler(backend));
  router.get('/tx/address/:address', directGetHandler(backend));
  // router.post('/tx/address', directPostHandler(backend));
  router.post('/tx/address', getTXByAddressesHandler(backend));
  return router;
}

export default restRouter;