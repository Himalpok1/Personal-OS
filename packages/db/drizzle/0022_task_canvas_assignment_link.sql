ALTER TABLE "tasks" ADD COLUMN "canvas_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_canvas_assignment_id_canvas_assignments_id_fk" FOREIGN KEY ("canvas_assignment_id") REFERENCES "public"."canvas_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_canvas_assignment_id_idx" ON "tasks" USING btree ("canvas_assignment_id");
