import { log } from "@personal-os/core/logging/logger";
import {
  ItemRefSchema,
  SearchQuerySchema,
  type ItemContext,
  type SearchResponse,
} from "@personal-os/schema";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getItemContext, searchPersonalItems } from "../search/service.js";

export default function searchRoutes(app: FastifyInstance): void {
  // Perimeter-only (Tailscale), like /today, /agenda and /health-metrics -- no
  // device-auth hook, deliberately. This is a read route over data the
  // perimeter already governs, and it exposes no row that GET /tasks,
  // GET /notes, GET /events, GET /projects or GET /inbox does not already
  // expose to the same callers.
  //
  // A missing, empty, whitespace-only, too-short, too-long or unknown query
  // parameter all reject with 400 validation_failed through the shared Zod
  // error handler. Nothing here can 5xx on user input, so no explicit 5xx reply
  // is needed (setErrorHandler only passes a thrown 4xx through).
  app.get<{ Querystring: Record<string, string> }>(
    "/search",
    async (request): Promise<SearchResponse> => {
      const query = SearchQuerySchema.parse(request.query);
      const startedAt = Date.now();
      const response = await searchPersonalItems(app.db, {
        q: query.q,
        types: query.types,
        limit: query.limit,
        tz: query.tz ?? null,
        includeArchived: query.include_archived,
        order: query.order,
      });

      // ONE structured line per search, COUNTS AND TOKENS ONLY. Never `q`, the
      // tokens, a title or a preview -- the request serializer already scrubs
      // `q` out of the access log (logging/scrub-url.ts), and this line must
      // not undo that. Through the guarded logger rather than `request.log`,
      // so a future field is scalar-only by type and name-denylisted by
      // construction; `termCount` rather than `token_count` because the
      // denylist drops any field whose name contains "token", by design.
      log.info("search.completed", {
        durationMs: Date.now() - startedAt,
        matchMode: response.match_mode,
        termCount: response.tokens.length + (response.date_filter === null ? 0 : 1),
        dateFilter: response.date_filter !== null,
        dateDropped: response.date_filter?.dropped ?? false,
        countTask: response.counts.task.total,
        countNote: response.counts.note.total,
        countEvent: response.counts.event.total,
        countProject: response.counts.project.total,
        countInboxItem: response.counts.inbox_item.total,
        countMailMessage: response.counts.mail_message.total,
      });

      return response;
    },
  );

  // The bounded single-item read behind ItemContextSchema. Perimeter-only for
  // the same reason as /search; a caller who can reach this can already read
  // the row through its own entity route. 404 for an unknown id AND for a
  // known id of the wrong type -- the two are indistinguishable on purpose.
  app.get<{ Querystring: Record<string, string> }>(
    "/search/item",
    async (request, reply: FastifyReply): Promise<ItemContext | { error: "not_found" }> => {
      const ref = ItemRefSchema.parse(request.query);
      const context = await getItemContext(app.db, ref, { includeBody: true });
      if (context === null) {
        return reply.code(404).send({ error: "not_found" });
      }
      return context;
    },
  );
}
