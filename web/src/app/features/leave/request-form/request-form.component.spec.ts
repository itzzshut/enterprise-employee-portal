import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { FormControl, FormGroup } from '@angular/forms';
import {
  RequestFormComponent,
  backdateValidator,
  countWorkingDays,
  dateRangeValidator,
  halfDayValidator,
  workingDaysValidator,
} from './request-form.component';
import type { LeaveBalance, LeaveType } from '@core/models';

/** Helper: the Monday three weeks out, so tests never straddle a weekend. */
function upcomingMonday(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 21);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  date.setHours(12, 0, 0, 0);
  return date;
}

function iso(date: Date, addDays = 0): string {
  const result = new Date(date);
  result.setDate(result.getDate() + addDays);
  return result.toISOString().slice(0, 10);
}

const MONDAY = upcomingMonday();
const MON = iso(MONDAY);
const FRI = iso(MONDAY, 4);
const SAT = iso(MONDAY, 5);
const SUN = iso(MONDAY, 6);

const LEAVE_TYPES: LeaveType[] = [
  {
    id: 1,
    code: 'ANNUAL',
    name: 'Annual Leave',
    default_annual_days: 20,
    requires_attachment: false,
    is_paid: true,
    color_hex: '#2563eb',
  },
  {
    id: 5,
    code: 'UNPAID',
    name: 'Unpaid Leave',
    default_annual_days: 0,
    requires_attachment: false,
    is_paid: false,
    color_hex: '#ca8a04',
  },
];

const BALANCES: LeaveBalance[] = [
  {
    leaveTypeId: 1,
    code: 'ANNUAL',
    name: 'Annual Leave',
    colorHex: '#2563eb',
    year: new Date().getFullYear(),
    entitledDays: 20,
    carriedOverDays: 0,
    usedDays: 16,
    pendingDays: 0,
    availableDays: 4,
  },
  {
    leaveTypeId: 5,
    code: 'UNPAID',
    name: 'Unpaid Leave',
    colorHex: '#ca8a04',
    year: new Date().getFullYear(),
    entitledDays: 0,
    carriedOverDays: 0,
    usedDays: 0,
    pendingDays: 0,
    availableDays: 0,
  },
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe('countWorkingDays', () => {
  it('counts Monday to Friday as five days', () => {
    expect(countWorkingDays(MON, FRI)).toBe(5);
  });

  it('ignores the weekend inside a longer range', () => {
    expect(countWorkingDays(MON, iso(MONDAY, 7))).toBe(6);
  });

  it('returns zero for a weekend-only range', () => {
    expect(countWorkingDays(SAT, SUN)).toBe(0);
  });

  it('returns 0.5 for a single-day half day', () => {
    expect(countWorkingDays(MON, MON, true)).toBe(0.5);
  });

  it('returns zero for a half day spanning two dates', () => {
    expect(countWorkingDays(MON, FRI, true)).toBe(0);
  });

  it('returns zero for an inverted or incomplete range', () => {
    expect(countWorkingDays(FRI, MON)).toBe(0);
    expect(countWorkingDays('', FRI)).toBe(0);
    expect(countWorkingDays(MON, 'nonsense')).toBe(0);
  });
});

describe('cross-field validators', () => {
  function group(startDate: string, endDate: string, halfDay = false): FormGroup {
    return new FormGroup({
      startDate: new FormControl(startDate),
      endDate: new FormControl(endDate),
      halfDay: new FormControl(halfDay),
    });
  }

  it('accepts a well-ordered range', () => {
    expect(dateRangeValidator(group(MON, FRI))).toBeNull();
  });

  it('flags an end date before the start date', () => {
    expect(dateRangeValidator(group(FRI, MON))).toEqual({ dateRange: true });
  });

  it('stays quiet until both dates are present', () => {
    expect(dateRangeValidator(group(MON, ''))).toBeNull();
    expect(dateRangeValidator(group('', FRI))).toBeNull();
  });

  it('accepts a half day on a single date', () => {
    expect(halfDayValidator(group(MON, MON, true))).toBeNull();
  });

  it('flags a half day spanning several dates', () => {
    expect(halfDayValidator(group(MON, FRI, true))).toEqual({ halfDaySpan: true });
  });

  it('ignores the half-day rule when the box is unchecked', () => {
    expect(halfDayValidator(group(MON, FRI, false))).toBeNull();
  });

  it('flags a range with no working days', () => {
    expect(workingDaysValidator(group(SAT, SUN))).toEqual({ noWorkingDays: true });
    expect(workingDaysValidator(group(MON, FRI))).toBeNull();
  });

  it('flags a start date more than a fortnight in the past', () => {
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 30);
    expect(backdateValidator(new FormControl(iso(longAgo)))).toEqual({ tooFarInPast: true });
  });

  it('allows a start date inside the back-dating window', () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 3);
    expect(backdateValidator(new FormControl(iso(recent)))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
describe('RequestFormComponent', () => {
  let fixture: ComponentFixture<RequestFormComponent>;
  let component: RequestFormComponent;
  let http: HttpTestingController;
  const router = { navigate: jest.fn() };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequestFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RequestFormComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();

    // The constructor loads types and balances.
    http.expectOne('/api/v1/leave/types').flush({ data: LEAVE_TYPES });
    http.expectOne('/api/v1/leave/balances').flush({ data: BALANCES });
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  /** Reaches the protected form the way the template does. */
  function form(): FormGroup {
    return (component as unknown as { form: FormGroup }).form;
  }

  function set(values: Record<string, unknown>): void {
    form().patchValue(values);
    fixture.detectChanges();
  }

  it('starts invalid and empty', () => {
    expect(form().invalid).toBe(true);
  });

  it('becomes valid once every field is filled sensibly', () => {
    set({ leaveTypeId: 1, startDate: MON, endDate: iso(MONDAY, 1), reason: 'Family wedding trip.' });
    expect(form().valid).toBe(true);
  });

  it('rejects a reason that is too short', () => {
    set({ leaveTypeId: 1, startDate: MON, endDate: MON, reason: 'short' });
    expect(form().controls['reason'].hasError('minlength')).toBe(true);
  });

  it('reports a dateRange error when the dates are inverted', () => {
    set({ leaveTypeId: 1, startDate: FRI, endDate: MON, reason: 'Inverted range test.' });
    expect(form().hasError('dateRange')).toBe(true);
    expect(form().invalid).toBe(true);
  });

  it('reports a halfDaySpan error for a multi-day half day', () => {
    set({ leaveTypeId: 1, startDate: MON, endDate: FRI, halfDay: true, reason: 'Half day test.' });
    expect(form().hasError('halfDaySpan')).toBe(true);
  });

  it('reports noWorkingDays for a weekend-only request', () => {
    set({ leaveTypeId: 1, startDate: SAT, endDate: SUN, reason: 'Weekend only request.' });
    expect(form().hasError('noWorkingDays')).toBe(true);
  });

  it('blocks a request that exceeds the remaining balance', () => {
    // 4 days available, Monday-to-Friday asks for 5.
    set({ leaveTypeId: 1, startDate: MON, endDate: FRI, reason: 'Five day holiday please.' });

    const state = component as unknown as {
      requestedDays: () => number;
      exceedsBalance: () => boolean;
      crossFieldError: () => string | null;
    };

    expect(state.requestedDays()).toBe(5);
    expect(state.exceedsBalance()).toBe(true);
    expect(state.crossFieldError()).toContain('only 4 remain');
  });

  it('allows a request that fits the remaining balance', () => {
    set({ leaveTypeId: 1, startDate: MON, endDate: iso(MONDAY, 3), reason: 'Four day break.' });

    const state = component as unknown as {
      requestedDays: () => number;
      exceedsBalance: () => boolean;
      remainingAfter: () => number;
    };

    expect(state.requestedDays()).toBe(4);
    expect(state.exceedsBalance()).toBe(false);
    expect(state.remainingAfter()).toBe(0);
  });

  it('never blocks unpaid leave on balance', () => {
    set({ leaveTypeId: 5, startDate: MON, endDate: FRI, reason: 'Unpaid sabbatical week.' });

    const state = component as unknown as { exceedsBalance: () => boolean };
    expect(state.exceedsBalance()).toBe(false);
  });

  it('submits the normalised payload and returns to the list', () => {
    set({ leaveTypeId: 1, startDate: MON, endDate: iso(MONDAY, 1), reason: 'Two day city break.' });

    (component as unknown as { submit: () => void }).submit();

    const request = http.expectOne('/api/v1/leave/requests');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      leaveTypeId: 1,
      startDate: MON,
      endDate: iso(MONDAY, 1),
      reason: 'Two day city break.',
      halfDay: false,
    });

    request.flush({
      request: { id: 91, totalDays: 2, currentApproverName: 'Marcus Lee' },
    });

    expect(router.navigate).toHaveBeenCalledWith(['/leave']);
  });

  it('does not submit an invalid form', () => {
    set({ leaveTypeId: 0, startDate: '', endDate: '', reason: '' });
    (component as unknown as { submit: () => void }).submit();

    http.expectNone('/api/v1/leave/requests');
    expect(form().touched).toBe(true);
  });
});
