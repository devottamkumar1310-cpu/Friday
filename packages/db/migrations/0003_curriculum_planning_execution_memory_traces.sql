CREATE TYPE "public"."concept_status" AS ENUM('not_started', 'in_progress', 'learned', 'mastered', 'excluded', 'already_known');--> statement-breakpoint
CREATE TYPE "public"."curriculum_source" AS ENUM('template', 'ai_generated', 'uploaded', 'manual');--> statement-breakpoint
CREATE TYPE "public"."edge_type" AS ENUM('prerequisite_of', 'related_to', 'applies_to', 'specializes');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('draft', 'active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('exam', 'skill', 'course', 'custom');--> statement-breakpoint
CREATE TYPE "public"."feasibility_verdict" AS ENUM('on_track', 'at_risk', 'not_feasible');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'superseded', 'archived');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'skipped', 'rescheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('learn', 'practice', 'revise', 'assess', 'project', 'break');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('self_rating', 'question_response', 'assessment', 'coach_check', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."fsrs_rating" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."decision_type" AS ENUM('next_action', 'plan_generation', 'revision_schedule', 'feasibility', 'diagnosis', 'directive', 'assessment_selection', 'scope_triage');--> statement-breakpoint
CREATE TABLE "canonical_concepts" (
	"key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"domain" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"from_concept_id" uuid NOT NULL,
	"to_concept_id" uuid NOT NULL,
	"type" "edge_type" DEFAULT 'prerequisite_of' NOT NULL,
	"strength" numeric(3, 2) DEFAULT '1.0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_edges_no_self_loop" CHECK ("concept_edges"."from_concept_id" <> "concept_edges"."to_concept_id")
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic_id" uuid NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_key" text,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"estimated_minutes" integer DEFAULT 30 NOT NULL,
	"difficulty" smallint DEFAULT 3 NOT NULL,
	"exam_weight" numeric(4, 3) DEFAULT '0.5' NOT NULL,
	"status" "concept_status" DEFAULT 'not_started' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concepts_minutes_range" CHECK ("concepts"."estimated_minutes" between 5 and 600),
	CONSTRAINT "concepts_difficulty_range" CHECK ("concepts"."difficulty" between 1 and 5),
	CONSTRAINT "concepts_exam_weight_range" CHECK ("concepts"."exam_weight" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "curricula" (
	"id" uuid PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "curriculum_source" NOT NULL,
	"template_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"generation_meta" jsonb,
	"total_concepts" integer DEFAULT 0 NOT NULL,
	"total_estimated_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"exam_board" text,
	"region" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"tree" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" "goal_type" NOT NULL,
	"status" "goal_status" DEFAULT 'draft' NOT NULL,
	"start_date" date DEFAULT now() NOT NULL,
	"target_date" date NOT NULL,
	"target_weekly_minutes" integer DEFAULT 600 NOT NULL,
	"self_reported_level" text,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "goals_target_after_start" CHECK ("goals"."target_date" > "goals"."start_date")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"weight" numeric(4, 3) DEFAULT '1.0' NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"weight" numeric(4, 3) DEFAULT '1.0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"weight" numeric(4, 3) DEFAULT '1.0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"supersedes_id" uuid,
	"reason" text NOT NULL,
	"reason_detail" jsonb,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"projection" jsonb NOT NULL,
	"pruned_at" timestamp with time zone,
	"verdict" "feasibility_verdict" NOT NULL,
	"required_minutes" integer NOT NULL,
	"available_minutes" integer NOT NULL,
	"slack_minutes" integer NOT NULL,
	"projected_completion_date" date,
	"reliability_factor" numeric(4, 3) DEFAULT '1.0' NOT NULL,
	"diff_summary" jsonb,
	"generated_by" text DEFAULT 'scheduler_v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scheduled_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"planned_minutes" integer NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_concepts" (
	"task_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	CONSTRAINT "task_concepts_task_id_concept_id_pk" PRIMARY KEY("task_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"block_id" uuid,
	"plan_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "task_type" NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"structural_score" numeric(8, 4),
	"structural_factors" jsonb,
	"scheduled_date" date NOT NULL,
	"completed_at" timestamp with time zone,
	"skipped_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"session_id" uuid,
	"source" "evidence_source" NOT NULL,
	"outcome" numeric(4, 3) NOT NULL,
	"difficulty" smallint,
	"response_ms" integer,
	"confidence" numeric(3, 2),
	"weight" numeric(4, 3) DEFAULT '1.0' NOT NULL,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"payload" jsonb NOT NULL,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"planned_minutes" integer,
	"active_minutes" integer DEFAULT 0 NOT NULL,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"focus_score" numeric(3, 2),
	"self_rating" "fsrs_rating",
	"notes" text,
	"originated_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_states" (
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"mastery" numeric(4, 3) DEFAULT '0' NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"distinct_sources" integer DEFAULT 0 NOT NULL,
	"outcome_variance" numeric(4, 3) DEFAULT '0' NOT NULL,
	"total_minutes" integer DEFAULT 0 NOT NULL,
	"accuracy_rate" numeric(4, 3),
	"first_studied_at" timestamp with time zone,
	"last_evidence_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_states_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id"),
	CONSTRAINT "mastery_states_mastery_range" CHECK ("mastery_states"."mastery" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "memory_states" (
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"stability" numeric(10, 4) DEFAULT '0' NOT NULL,
	"difficulty" numeric(6, 4) DEFAULT '5' NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" smallint DEFAULT 0 NOT NULL,
	"last_review_at" timestamp with time zone,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_states_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "decision_traces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"type" "decision_type" NOT NULL,
	"engine_version" text NOT NULL,
	"config_version" text NOT NULL,
	"input_snapshot_hash" text NOT NULL,
	"input_snapshot" jsonb,
	"candidates" jsonb NOT NULL,
	"excluded" jsonb,
	"selected_entity_id" uuid,
	"selected_score" numeric(10, 4),
	"modifiers_applied" jsonb,
	"constraints_relaxed" text[],
	"confidence" numeric(4, 3) NOT NULL,
	"confidence_inputs" jsonb NOT NULL,
	"dominant_factor" text,
	"explanation" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latency_ms" integer,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"request_id" text,
	"superseded_by" uuid
);
--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_from_concept_id_concepts_id_fk" FOREIGN KEY ("from_concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_to_concept_id_concepts_id_fk" FOREIGN KEY ("to_concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_concept_key_canonical_concepts_key_fk" FOREIGN KEY ("concept_key") REFERENCES "public"."canonical_concepts"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_template_id_curriculum_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."curriculum_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_blocks" ADD CONSTRAINT "study_blocks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_blocks" ADD CONSTRAINT "study_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_concepts" ADD CONSTRAINT "task_concepts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_concepts" ADD CONSTRAINT "task_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_concepts" ADD CONSTRAINT "task_concepts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_block_id_study_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."study_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_states" ADD CONSTRAINT "mastery_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_states" ADD CONSTRAINT "mastery_states_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_states" ADD CONSTRAINT "memory_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_states" ADD CONSTRAINT "memory_states_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_traces" ADD CONSTRAINT "decision_traces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_traces" ADD CONSTRAINT "decision_traces_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concept_edges_unique" ON "concept_edges" USING btree ("from_concept_id","to_concept_id","type");--> statement-breakpoint
CREATE INDEX "concept_edges_to_idx" ON "concept_edges" USING btree ("to_concept_id","type");--> statement-breakpoint
CREATE INDEX "concept_edges_from_idx" ON "concept_edges" USING btree ("from_concept_id","type");--> statement-breakpoint
CREATE INDEX "concepts_curriculum_status_idx" ON "concepts" USING btree ("curriculum_id","status");--> statement-breakpoint
CREATE INDEX "concepts_key_idx" ON "concepts" USING btree ("concept_key");--> statement-breakpoint
CREATE INDEX "concepts_user_idx" ON "concepts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "curricula_goal_idx" ON "curricula" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_templates_slug_key" ON "curriculum_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "subjects_curriculum_idx" ON "subjects" USING btree ("curriculum_id","position");--> statement-breakpoint
CREATE INDEX "topics_unit_idx" ON "topics" USING btree ("unit_id","position");--> statement-breakpoint
CREATE INDEX "units_subject_idx" ON "units" USING btree ("subject_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_goal_version_key" ON "plans" USING btree ("goal_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_active" ON "plans" USING btree ("goal_id") WHERE "plans"."status" = 'active';--> statement-breakpoint
CREATE INDEX "plans_goal_active_idx" ON "plans" USING btree ("goal_id") WHERE "plans"."status" = 'active';--> statement-breakpoint
CREATE INDEX "study_blocks_user_date_idx" ON "study_blocks" USING btree ("user_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "tasks_user_date_status_idx" ON "tasks" USING btree ("user_id","scheduled_date","status") WHERE "tasks"."status" in ('pending', 'in_progress');--> statement-breakpoint
CREATE INDEX "tasks_plan_idx" ON "tasks" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "evidence_events_user_concept_time_idx" ON "evidence_events" USING btree ("user_id","concept_id","occurred_at");--> statement-breakpoint
CREATE INDEX "learning_events_user_time_idx" ON "learning_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "study_sessions_user_start_idx" ON "study_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "decision_traces_user_type_time_idx" ON "decision_traces" USING btree ("user_id","type","computed_at");--> statement-breakpoint
CREATE INDEX "decision_traces_request_idx" ON "decision_traces" USING btree ("request_id");