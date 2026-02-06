import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { Semaphore } from './Semaphore';

export interface RPCRequest {
  method: string;
  params: any[];
  id: string | null;
}

export interface RPCError {
  message: string;
  code: number;
}

export interface RPCResponse {
  result: any;
  error: RPCError | null;
  id: string | number | null;
}

export const invalidRequest = {
  message: 'Invalid request.',
  code: -32600,
};

export const methodNotFound = {
  message: 'Method not found.',
  code: -32601,
};

export const invalidParams = {
  message: 'Invalid params.',
  code: -32602,
};

export const internalError = {
  message: 'Internal error.',
  code: -32603,
};

export const parseError = {
  message: 'Parse error.',
  code: -32700,
};

export class Backend {
  private axios: AxiosInstance;

  private lastId = 0;

  private sem: Semaphore;

  constructor(url: string, concurrency: number = 50) {
    this.axios = axios.create({
      baseURL: url,
    });
    this.sem = new Semaphore(concurrency);
  }

  async doGet(path: string): Promise<AxiosResponse> {
    return this.sem.take<AxiosResponse>(() => this.axios.get(path));
  }

  async doPost(path: string, body: any): Promise<AxiosResponse> {
    return this.sem.take<AxiosResponse>(() => this.axios.post(path, body));
  }

  async execRpc(method: string, params: any): Promise<RPCResponse> {
    const id = String(++this.lastId);
    const res = await this.doPost('/', {
      method,
      params,
      id,
    } as RPCRequest);
    return res.data as RPCResponse;
  }
}
