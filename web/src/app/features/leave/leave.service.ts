import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import type {
  CalendarEntry,
  LeaveBalance,
  LeaveRequest,
  LeaveRequestDetail,
  LeaveType,
  Paginated,
} from '@core/models';

export interface LeaveListQuery {
  status?: string;
  leaveTypeId?: number;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export interface SubmitLeavePayload {
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  reason: string;
  halfDay: boolean;
}

/**
 * Feature-scoped data access for the leave module.
 *
 * Components never call ApiService directly: keeping the endpoint strings here
 * means a route change is a one-line edit, and the components stay about
 * presentation and form state.
 */
@Injectable({ providedIn: 'root' })
export class LeaveService {
  private readonly api = inject(ApiService);

  listTypes(): Observable<{ data: LeaveType[] }> {
    return this.api.get<{ data: LeaveType[] }>('/leave/types');
  }

  balances(employeeId?: number, year?: number): Observable<{ data: LeaveBalance[] }> {
    return this.api.get<{ data: LeaveBalance[] }>('/leave/balances', { employeeId, year });
  }

  myRequests(query: LeaveListQuery = {}): Observable<Paginated<LeaveRequest>> {
    return this.api.get<Paginated<LeaveRequest>>('/leave/requests', { ...query });
  }

  approvalQueue(query: LeaveListQuery = {}): Observable<Paginated<LeaveRequest>> {
    return this.api.get<Paginated<LeaveRequest>>('/leave/approvals', { ...query });
  }

  teamRequests(query: LeaveListQuery = {}): Observable<Paginated<LeaveRequest>> {
    return this.api.get<Paginated<LeaveRequest>>('/leave/team', { ...query });
  }

  detail(id: number): Observable<LeaveRequestDetail> {
    return this.api.get<LeaveRequestDetail>(`/leave/requests/${id}`);
  }

  submit(payload: SubmitLeavePayload): Observable<{ request: LeaveRequest }> {
    return this.api.post<{ request: LeaveRequest }>('/leave/requests', payload);
  }

  decide(
    id: number,
    decision: 'APPROVED' | 'REJECTED',
    comments?: string,
  ): Observable<{ request: LeaveRequest }> {
    return this.api.post<{ request: LeaveRequest }>(`/leave/requests/${id}/decision`, {
      decision,
      comments,
    });
  }

  cancel(id: number, reason?: string): Observable<{ request: LeaveRequest }> {
    return this.api.post<{ request: LeaveRequest }>(`/leave/requests/${id}/cancel`, { reason });
  }

  calendar(
    from: string,
    to: string,
    scope: 'ME' | 'TEAM' | 'COMPANY' = 'TEAM',
  ): Observable<{ data: CalendarEntry[] }> {
    return this.api.get<{ data: CalendarEntry[] }>('/leave/calendar', { from, to, scope });
  }
}
