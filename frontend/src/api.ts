import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'fa_token';

export const tokenStore = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

export const http = axios.create({ baseURL: '/api', timeout: 120000 });

http.interceptors.request.use((cfg) => {
  const t = tokenStore.get();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// A 401 on any non-login call means the session ended: drop the token and return to the login screen.
http.interceptors.response.use(
  (r) => r,
  (err: AxiosError<any>) => {
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !url.includes('/auth/login')) {
      tokenStore.clear();
      window.dispatchEvent(new Event('fa:unauthorized'));
    }
    return Promise.reject(err);
  }
);

/** Human-readable message from any API/network error. */
export function errMsg(e: any): string {
  if (e?.response?.data?.error?.message) return e.response.data.error.message;
  if (e?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (e?.message === 'Network Error') return 'Cannot reach the server. Check that the backend is running.';
  return e?.message || 'Something went wrong.';
}

export async function get<T = any>(url: string, params?: Record<string, any>): Promise<T> {
  const clean = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)) : undefined;
  return (await http.get(url, { params: clean })).data.data as T;
}
export async function post<T = any>(url: string, body?: any): Promise<T> {
  return (await http.post(url, body ?? {})).data.data as T;
}
export async function put<T = any>(url: string, body?: any): Promise<T> {
  return (await http.put(url, body ?? {})).data.data as T;
}
export async function patch<T = any>(url: string, body?: any): Promise<T> {
  return (await http.patch(url, body ?? {})).data.data as T;
}
export async function del<T = any>(url: string): Promise<T> {
  return (await http.delete(url)).data.data as T;
}

/** Download a binary/text response through the authenticated client and hand it to the browser. */
export async function download(url: string, params?: Record<string, any>, fallbackName = 'download') {
  const res = await http.get(url, { params, responseType: 'blob' });
  const cd: string = res.headers['content-disposition'] || '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  const a = document.createElement('a');
  const href = URL.createObjectURL(res.data);
  a.href = href;
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
