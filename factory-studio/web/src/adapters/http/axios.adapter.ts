import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { v4 as uuid } from 'uuid';

export interface HttpAdapterSettings {
  baseURL: string;
  timeoutMs?: number;
}

/**
 * One axios instance, with interceptors that log the request and the response under a
 * client request id — so a failed call can be followed from the console line to the API's
 * own log, which answers every request with its `x-request-id`.
 *
 * No key, no API URL: the app talks to the origin it was served from.
 */
export const createHttpAdapter = (settings: HttpAdapterSettings): AxiosInstance => {
  const instance: AxiosInstance = axios.create({
    baseURL: settings.baseURL,
    timeout: settings.timeoutMs ?? 30_000,
  });

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const requestId: string = uuid();
    config.headers.set('x-client-request-id', requestId);
    console.debug('[http] →', { requestId, method: config.method, url: config.url });
    return config;
  });

  instance.interceptors.response.use(
    (response: AxiosResponse): AxiosResponse => {
      console.debug('[http] ←', {
        requestId: response.config.headers?.get?.('x-client-request-id'),
        serverRequestId: response.headers['x-request-id'],
        status: response.status,
        url: response.config.url,
      });
      return response;
    },
    (error: unknown): Promise<never> => {
      const failure = error as { response?: { status?: number; data?: unknown }; message?: string };
      console.error('[http] ✕', {
        status: failure.response?.status,
        body: failure.response?.data,
        message: failure.message,
      });
      return Promise.reject(error);
    },
  );

  return instance;
};

/** The one instance the app uses. */
export const http: AxiosInstance = createHttpAdapter({ baseURL: '/' });
