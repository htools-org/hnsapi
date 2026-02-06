import express from 'express';
import {RedisCache} from './cache';
import {Backend} from './client';
import rpcRouter from './rpc';
import restRouter from './rest';
import morgan from 'morgan';
import helmet from 'helmet';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));

console.log(process.env);

const backend = new Backend(process.env.BACKEND_URL || 'http://x:apikey@127.0.0.1:12037');
const cache = new RedisCache(process.env.REDIS_URL || 'redis://localhost:6379');
const rest = restRouter(backend, cache);
const rpc = rpcRouter(backend, cache);

app.use('/hsd', rest);
app.post('/hsd', rpc);
app.get('/healthz', (req, res) => {
  res.json({
    message: 'OK'
  });
});
app.listen(process.env.PORT ? Number(process.env.PORT) : 8080, () => console.log('Listening.'));