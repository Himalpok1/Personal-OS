import {
  GoogleHealthApiError,
  type ApiCivilDateTime,
  type ApiDailyRollupDataPoint,
  type ApiDataPoint,
  type DailyRollUpRequest,
  type DailyRollUpResponse,
  type DataPointPage,
  type GoogleHealthClient,
  type GoogleHealthIdentity,
  type ListRequest,
  type ReconcileRequest,
} from "./google-health-client.js";

// In-memory GoogleHealthClient for tests. No network, ever.
//
// Scripted rather than stateful: each method drains a per-dataType FIFO queue of
// prepared responses, so a test states exactly what the API returns on call 1,
// call 2, ... Draining an EMPTY queue throws, so an unexpected extra call fails
// loudly instead of silently yielding an empty page and a green test. That
// convention is taken from google-calendar-client.fake.ts, which earns its keep.

export interface FakeCall {
  method: "getIdentity" | "dailyRollUp" | "list" | "reconcile";
  dataType?: string;
  filter?: string;
  pageToken?: string;
  dataSourceFamily?: string;
  windowSizeDays?: number;
  pageSize?: number;
}

type Scripted<T> = T | GoogleHealthApiError;

export interface FakeGoogleHealthOptions {
  identity?: GoogleHealthIdentity;
}

export interface FakeGoogleHealthClient extends GoogleHealthClient {
  readonly calls: FakeCall[];
  queueDailyRollUp(dataType: string, response: Scripted<DailyRollUpResponse>): void;
  queueList(dataType: string, response: Scripted<DataPointPage>): void;
  queueReconcile(dataType: string, response: Scripted<DataPointPage>): void;
  queueIdentity(response: Scripted<GoogleHealthIdentity>): void;
  /** Calls recorded for one method, in order. */
  callsFor(method: FakeCall["method"]): FakeCall[];
}

/** Convenience: a CivilDateTime from a "YYYY-MM-DD" string. */
export function civil(localDate: string, hours = 0): ApiCivilDateTime {
  const [y, m, d] = localDate.split("-").map(Number);
  return { date: { year: y!, month: m!, day: d! }, time: { hours } };
}

/** Convenience: a rollup bucket for one civil day carrying one value field. */
export function rollupBucket(
  localDate: string,
  valueField: string,
  value: unknown,
): ApiDailyRollupDataPoint {
  const next = new Date(Date.parse(localDate + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  return {
    civilStartTime: civil(localDate),
    civilEndTime: civil(next),
    [valueField]: value,
  };
}

export function createFakeGoogleHealthClient(
  options: FakeGoogleHealthOptions = {},
): FakeGoogleHealthClient {
  const calls: FakeCall[] = [];
  const rollupQueues = new Map<string, Scripted<DailyRollUpResponse>[]>();
  const listQueues = new Map<string, Scripted<DataPointPage>[]>();
  const reconcileQueues = new Map<string, Scripted<DataPointPage>[]>();
  const identityQueue: Scripted<GoogleHealthIdentity>[] = [];

  function enqueue<T>(map: Map<string, Scripted<T>[]>, key: string, value: Scripted<T>): void {
    const q = map.get(key) ?? [];
    q.push(value);
    map.set(key, q);
  }

  function drain<T>(map: Map<string, Scripted<T>[]>, key: string, label: string): T {
    const q = map.get(key);
    if (!q || q.length === 0) {
      throw new Error(
        `FakeGoogleHealthClient: unexpected ${label} call for "${key}" -- nothing queued. ` +
          `Queue a response, or fix the code under test if the call is not wanted.`,
      );
    }
    const next = q.shift()!;
    if (next instanceof GoogleHealthApiError) throw next;
    return next;
  }

  return {
    calls,
    callsFor(method) {
      return calls.filter((c) => c.method === method);
    },
    queueDailyRollUp(dataType, response) {
      enqueue(rollupQueues, dataType, response);
    },
    queueList(dataType, response) {
      enqueue(listQueues, dataType, response);
    },
    queueReconcile(dataType, response) {
      enqueue(reconcileQueues, dataType, response);
    },
    queueIdentity(response) {
      identityQueue.push(response);
    },

    getIdentity(): Promise<GoogleHealthIdentity> {
      calls.push({ method: "getIdentity" });
      return Promise.resolve().then(() => {
        if (identityQueue.length > 0) {
          const next = identityQueue.shift()!;
          if (next instanceof GoogleHealthApiError) throw next;
          return next;
        }
        return options.identity ?? { healthUserId: "fake-health-user", legacyUserId: null };
      });
    },

    dailyRollUp(req: DailyRollUpRequest): Promise<DailyRollUpResponse> {
      const call: FakeCall = { method: "dailyRollUp", dataType: req.dataType };
      if (req.windowSizeDays !== undefined) call.windowSizeDays = req.windowSizeDays;
      // No pageSize: DailyRollUpRequest deliberately cannot carry one.
      if (req.dataSourceFamily !== undefined) call.dataSourceFamily = req.dataSourceFamily;
      calls.push(call);
      return Promise.resolve().then(() => drain(rollupQueues, req.dataType, "dailyRollUp"));
    },

    list(req: ListRequest): Promise<DataPointPage> {
      const call: FakeCall = { method: "list", dataType: req.dataType, filter: req.filter };
      if (req.pageToken !== undefined) call.pageToken = req.pageToken;
      if (req.pageSize !== undefined) call.pageSize = req.pageSize;
      calls.push(call);
      return Promise.resolve().then(() => drain(listQueues, req.dataType, "list"));
    },

    reconcile(req: ReconcileRequest): Promise<DataPointPage> {
      const call: FakeCall = {
        method: "reconcile",
        dataType: req.dataType,
        filter: req.filter,
      };
      if (req.pageToken !== undefined) call.pageToken = req.pageToken;
      if (req.pageSize !== undefined) call.pageSize = req.pageSize;
      if (req.dataSourceFamily !== undefined) call.dataSourceFamily = req.dataSourceFamily;
      calls.push(call);
      return Promise.resolve().then(() => drain(reconcileQueues, req.dataType, "reconcile"));
    },
  };
}

/** A sample data point, for list/reconcile scripting. */
export function samplePoint(
  valueField: string,
  value: unknown,
  extra: Partial<ApiDataPoint> = {},
): ApiDataPoint {
  return { [valueField]: value, ...extra };
}
