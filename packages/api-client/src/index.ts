import { HealthCheckResponseSchema, type HealthCheckResponse } from "@personal-os/schema";

export function createApiClient(baseUrl: string) {
  return {
    async health(): Promise<HealthCheckResponse> {
      const response = await fetch(new URL("/health", baseUrl));
      const body: unknown = await response.json();
      return HealthCheckResponseSchema.parse(body);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
