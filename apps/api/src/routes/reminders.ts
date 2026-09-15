import { RemindersQuerySchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { buildRemindersResponse } from "../read-models/reminders.js";

// GET /reminders (Checkpoint 9.4). A thin caller of the reminders read model
// since Checkpoint 9.7 extracted it to read-models/reminders.ts so the Ask
// lane's Today context can share it -- the semantics, the grace rules and
// the strict wire shape are all documented there. The route deliberately
// passes NO `oneOffHorizon`: the device must keep scheduling one-off
// reminders however far out they are.
export default function remindersRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/reminders", async (request) => {
    const query = RemindersQuerySchema.parse(request.query);
    return buildRemindersResponse(app.db, query, { now: new Date() });
  });
}
