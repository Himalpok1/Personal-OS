import { ApiClientError } from "@personal-os/api-client";
import type {
  AiModel,
  AiProviderConnection,
  AiProviderType,
  AiTaskRouteInfo,
  AskScope,
} from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isAskConsentOutdatedError, isCloudAskDisabledError } from "@/components/ask/ask-errors";
import { api } from "./client";
import { deviceTimezone } from "./today";

// Cloud Ask query/mutation hooks (Checkpoint 8.6B).
//
// The task-name "ask" row in `ai_task_routes` IS the on/off switch -- there is
// no separate settings flag anywhere. `GET /ai/task-routes` is therefore the
// single source of truth both the search screen (is Ask mode available at
// all?) and the Settings card (is it currently on?) read, sharing ONE query
// key so enabling/disabling in Settings is reflected on the search screen
// without a restart -- see `AI_TASK_ROUTES_QUERY_KEY`.

export const ASK_TASK_NAME = "ask";

export const AI_TASK_ROUTES_QUERY_KEY = ["ai-task-routes"] as const;
const AI_MODELS_QUERY_KEY = ["ai-models"] as const;
const AI_PROVIDERS_QUERY_KEY = ["ai-providers"] as const;
/**
 * Checkpoint 9.7: whether the server has refused a question with
 * `409 ask_consent_outdated` -- the "ask" row was created under the 8.6B
 * disclosure, before "Ask about today" widened what leaves the device. Held
 * in the query cache rather than component state so the Settings card (which
 * carries no local state by design -- see cloud-ask-card.tsx) can read it
 * without being told, and so it is one flag per app process rather than one
 * per screen. Cleared when the stale row is deleted: re-enabling then creates
 * a fresh row under the current disclosure.
 */
export const ASK_CONSENT_OUTDATED_QUERY_KEY = ["ask-consent-outdated"] as const;

/**
 * Pure: picks the "ask" row out of the full task-route list, or null if Cloud
 * Ask has never been enabled (or was just disabled). Exported so the
 * enabled/disabled derivation is unit-testable without a live QueryClient.
 */
export function findAskRoute(routes: AiTaskRouteInfo[] | undefined): AiTaskRouteInfo | null {
  if (!routes) return null;
  return routes.find((route) => route.task_name === ASK_TASK_NAME) ?? null;
}

export function useAskEnabled() {
  const query = useQuery({
    queryKey: AI_TASK_ROUTES_QUERY_KEY,
    queryFn: () => api.getTaskRoutes(),
  });
  const route = findAskRoute(query.data);
  return { ...query, enabled: route !== null, route };
}

export interface AskModelOption {
  /** `ai_models.id` -- what `createTaskRoute("ask", ...)` expects. */
  modelId: string;
  modelLabel: string;
  connectionId: string;
  connectionName: string;
  providerType: AiProviderType;
}

/**
 * Pure: joins `ai_models` rows onto their `ai_provider_connections` row.
 *
 * A model whose connection cannot be found (deleted between the two fetches)
 * is dropped rather than shown with a guessed connection name -- there is
 * nothing honest to say about it. A model on a DISABLED connection is
 * dropped too: the disclosure list is only ever offering choices that could
 * actually serve a question.
 */
export function joinModelsWithConnections(
  models: AiModel[],
  connections: AiProviderConnection[],
): AskModelOption[] {
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const options: AskModelOption[] = [];
  for (const model of models) {
    const connection = byId.get(model.provider_connection_id);
    if (!connection || !connection.enabled) continue;
    options.push({
      modelId: model.id,
      modelLabel: model.display_name ?? model.model_id,
      connectionId: connection.id,
      connectionName: connection.name,
      providerType: connection.provider_type,
    });
  }
  return options;
}

export function useAskModels(): {
  models: AskModelOption[];
  isLoading: boolean;
  isError: boolean;
} {
  const modelsQuery = useQuery({
    queryKey: AI_MODELS_QUERY_KEY,
    queryFn: () => api.listAiModels(),
  });
  const providersQuery = useQuery({
    queryKey: AI_PROVIDERS_QUERY_KEY,
    queryFn: () => api.listAiProviders(),
  });

  const models =
    modelsQuery.data && providersQuery.data
      ? joinModelsWithConnections(modelsQuery.data, providersQuery.data)
      : [];

  return {
    models,
    isLoading: modelsQuery.isLoading || providersQuery.isLoading,
    isError: modelsQuery.isError || providersQuery.isError,
  };
}

/**
 * Enables Cloud Ask by creating the "ask" task route.
 *
 * The server refuses to re-point an existing "ask" route
 * (`409 ask_route_immutable`) -- changing the model is a delete-then-create
 * cycle, which is the re-consent moment the 8.6B design requires. That
 * specific refusal is swallowed here and treated as "already enabled" rather
 * than surfaced as a failure: the `onSettled` refetch below picks up whatever
 * route actually exists either way, so the caller never needs to special-case
 * it.
 */
export function useEnableCloudAsk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string) => {
      try {
        return await api.createTaskRoute(ASK_TASK_NAME, modelId);
      } catch (err) {
        if (err instanceof ApiClientError && err.code === "ask_route_immutable") {
          return null;
        }
        throw err;
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: AI_TASK_ROUTES_QUERY_KEY }),
  });
}

/** Disables Cloud Ask by deleting the "ask" task route. Resolves even if already gone. */
export function useDisableCloudAsk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteTaskRoute(ASK_TASK_NAME),
    onSuccess: () => handleDisableCloudAskSuccess(queryClient),
  });
}

/**
 * After the "ask" row is deleted: the routes list is stale, and any
 * consent-outdated flag is cleared -- the outdated row is gone with the
 * route, so whatever is created next is consented under the disclosure
 * currently on screen.
 */
export function handleDisableCloudAskSuccess(queryClient: QueryClient): void {
  queryClient.setQueryData(ASK_CONSENT_OUTDATED_QUERY_KEY, false);
  void queryClient.invalidateQueries({ queryKey: AI_TASK_ROUTES_QUERY_KEY });
}

/**
 * True once a `409 ask_consent_outdated` has been seen in this app process
 * (and the stale route has not since been deleted). Never fetched: the only
 * writer is `useAskCloud`'s error path, and the only reset is a successful
 * disable. `false` until then, deterministically -- the `queryFn` exists to
 * satisfy the library and can only ever return the same default.
 */
export function useAskConsentOutdated(): boolean {
  const query = useQuery({
    queryKey: ASK_CONSENT_OUTDATED_QUERY_KEY,
    queryFn: () => false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return query.data === true;
}

/** What `useAskCloud` submits: the question plus which context it may reach. */
export interface AskCloudInput {
  question: string;
  /**
   * `today` -- a preset chip: the Today context only, no note/task body is
   * selected server-side. `both` -- free text: the lexical note/task
   * selection runs beside the Today context, as 8.6B did.
   */
  scope: AskScope;
}

/**
 * The raw mutation config for asking a question, exported separately from the
 * hook so `ask.test.ts` can wire it into a bare `MutationObserver` and prove,
 * against the real library, that neither a focus regain nor a reconnect event
 * ever calls `api.askCloud` on their own.
 *
 * `retry: 0` IS THE POINT: a retried Ask would silently re-transmit the
 * user's note/task text without a second tap, which is exactly the mistake
 * `useQuery`'s defaults (retry, refetch-on-focus, refetch-on-reconnect) would
 * make if this were ever written as a query instead of a mutation. See
 * `mail.ts`'s `useGmailAuthorizeUrl` for the same reasoning applied to a
 * different single-shot action.
 */
export function askCloudMutationOptions() {
  return {
    // `tz` is always sent (Checkpoint 9.7): it is what turns the Today
    // context on server-side, from the same helper Today and Search use, so
    // "today" and "tomorrow" mean the device's own calendar day. The server
    // never guesses a zone.
    mutationFn: (input: AskCloudInput) =>
      api.askCloud({ question: input.question, scope: input.scope, tz: deviceTimezone() }),
    retry: 0 as const,
  };
}

/**
 * Submits one question. NEVER a `useQuery`: see `askCloudMutationOptions`.
 * A `cloud_ask_disabled` response means the switch changed under us (someone
 * disabled it, possibly from another device, between the mode toggle
 * appearing and the tap) -- refetching the task-routes list here is what
 * makes the Ask mode disappear on its own rather than staying offered.
 */
export function useAskCloud() {
  const queryClient = useQueryClient();
  return useMutation({
    ...askCloudMutationOptions(),
    onError: (err: unknown) => handleAskCloudError(queryClient, err),
  });
}

/**
 * The cache side-effects of a failed Ask, kept separate from the hook so they
 * are testable against a bare `QueryClient`. Two codes carry a consequence
 * beyond the error banner: `cloud_ask_disabled` means the cached "is it on"
 * answer is stale; `ask_consent_outdated` is remembered for the Settings
 * card, which offers the re-enable path (delete the stale row, then pick a
 * model under the new disclosure). Every other error changes nothing here.
 */
export function handleAskCloudError(queryClient: QueryClient, err: unknown): void {
  if (isCloudAskDisabledError(err)) {
    void queryClient.invalidateQueries({ queryKey: AI_TASK_ROUTES_QUERY_KEY });
  }
  if (isAskConsentOutdatedError(err)) {
    queryClient.setQueryData(ASK_CONSENT_OUTDATED_QUERY_KEY, true);
  }
}
