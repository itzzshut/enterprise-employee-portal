import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/**
 * Thin HttpClient wrapper.
 *
 * Its whole job is to own the API prefix and to drop null/undefined query
 * values, so feature services never build `?status=undefined` by accident. It
 * deliberately does not add caching, retries or error handling — those belong
 * to interceptors, where they apply uniformly.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/v1';

  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.http.get<T>(this.url(path), { params: this.toParams(params) });
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(this.url(path), body ?? {});
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(this.url(path), body ?? {});
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http.patch<T>(this.url(path), body ?? {});
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(this.url(path));
  }

  /** Multipart upload — the browser sets the boundary, so no Content-Type here. */
  upload<T>(path: string, formData: FormData): Observable<T> {
    return this.http.post<T>(this.url(path), formData);
  }

  download(path: string): Observable<Blob> {
    return this.http.get(this.url(path), { responseType: 'blob' });
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private toParams(params?: QueryParams): HttpParams {
    let httpParams = new HttpParams();
    if (!params) return httpParams;

    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === '') continue;
      httpParams = httpParams.set(key, String(value));
    }
    return httpParams;
  }
}
