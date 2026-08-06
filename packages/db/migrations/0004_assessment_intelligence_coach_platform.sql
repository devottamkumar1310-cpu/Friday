CREATE TYPE "public"."fact_category" AS ENUM('learning_style', 'misconception', 'strength', 'weakness', 'preference', 'constraint', 'motivation', 'goal_context');--> statement-breakpoint
CREATE TYPE "public"."assessment_type" AS ENUM('diagnostic', 'practice_set', 'topic_quiz', 'mock_test');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'active', 'quarantined', 'retired');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq_single', 'mcq_multi', 'short_answer', 'numeric', 'true_false');--> statement-breakpoint
CREATE TYPE "public"."insight_type" AS ENUM('weakness', 'strength', 'trend', 'risk', 'milestone', 'root_cause', 'recommendation');--> statement-breakpoint
CREATE TABLE "learner_facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "fact_category" NOT NULL,
	"statement" text NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '0.5' NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"concept_ids" uuid[] DEFAULT '{}'::uuid[],
	"reinforcement_count" integer DEFAULT 1 NOT NULL,
	"last_reinforced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_user_edited" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"type" "assessment_type" NOT NULL,
	"title" text NOT NULL,
	"concept_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"time_limit_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assessment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"score" numeric(5, 2),
	"max_score" numeric(5, 2),
	"concept_breakdown" jsonb,
	"time_spent_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "question_concept_keys" (
	"question_id" uuid NOT NULL,
	"concept_key" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "question_concept_keys_question_id_concept_key_pk" PRIMARY KEY("question_id","concept_key")
);
--> statement-breakpoint
CREATE TABLE "question_exposures" (
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"times_seen" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_exposures_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"concept_key" text NOT NULL,
	"type" "question_type" NOT NULL,
	"status" "question_status" DEFAULT 'draft' NOT NULL,
	"difficulty" smallint NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb,
	"correct_answer" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"rubric" jsonb,
	"generation_meta" jsonb,
	"quality_score" numeric(3, 2),
	"times_served" integer DEFAULT 0 NOT NULL,
	"times_correct" integer DEFAULT 0 NOT NULL,
	"reported_count" integer DEFAULT 0 NOT NULL,
	"irt_difficulty" numeric(5, 3),
	"irt_discrimination" numeric(5, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_difficulty_range" CHECK ("questions"."difficulty" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"is_correct" boolean,
	"score" numeric(5, 2),
	"grading_method" text,
	"grader_feedback" text,
	"response_ms" integer,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"type" "insight_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" smallint DEFAULT 2 NOT NULL,
	"concept_ids" uuid[] DEFAULT '{}'::uuid[],
	"evidence" jsonb NOT NULL,
	"is_dismissed" boolean DEFAULT false NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"weighted_progress" numeric(5, 4) NOT NULL,
	"concepts_mastered" integer DEFAULT 0 NOT NULL,
	"concepts_total" integer NOT NULL,
	"minutes_studied" integer DEFAULT 0 NOT NULL,
	"accuracy_rate" numeric(4, 3),
	"adherence_rate" numeric(4, 3),
	"verdict" "feasibility_verdict",
	"projected_completion_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"context_packet_ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"title" text,
	"concept_ids" uuid[] DEFAULT '{}'::uuid[],
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"agent" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_tokens" integer,
	"cost_usd" numeric(10, 6),
	"latency_ms" integer,
	"status" text NOT NULL,
	"context_packet" jsonb,
	"error" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"rollout_percentage" smallint DEFAULT 0 NOT NULL,
	"user_allowlist" uuid[] DEFAULT '{}'::uuid[],
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_id" uuid NOT NULL,
	"period" date NOT NULL,
	"ai_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"ai_calls" integer DEFAULT 0 NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_user_id_period_pk" PRIMARY KEY("user_id","period")
);
--> statement-breakpoint
ALTER TABLE "learner_facts" ADD CONSTRAINT "learner_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_concept_keys" ADD CONSTRAINT "question_concept_keys_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_concept_keys" ADD CONSTRAINT "question_concept_keys_concept_key_canonical_concepts_key_fk" FOREIGN KEY ("concept_key") REFERENCES "public"."canonical_concepts"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_exposures" ADD CONSTRAINT "question_exposures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_exposures" ADD CONSTRAINT "question_exposures_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_concept_key_canonical_concepts_key_fk" FOREIGN KEY ("concept_key") REFERENCES "public"."canonical_concepts"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_thread_id_coach_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coach_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_context_packet_ref_ai_calls_id_fk" FOREIGN KEY ("context_packet_ref") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_threads" ADD CONSTRAINT "coach_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_threads" ADD CONSTRAINT "coach_threads_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facts_user_conf_idx" ON "learner_facts" USING btree ("user_id","confidence") WHERE not "learner_facts"."is_archived";--> statement-breakpoint
CREATE INDEX "assessments_user_goal_idx" ON "assessments" USING btree ("user_id","goal_id");--> statement-breakpoint
CREATE INDEX "attempts_user_idx" ON "attempts" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "exposures_user_idx" ON "question_exposures" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "questions_lookup_idx" ON "questions" USING btree ("concept_key","difficulty","status") WHERE "questions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "responses_attempt_idx" ON "responses" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "insights_user_active_idx" ON "insights" USING btree ("user_id","created_at") WHERE not "insights"."is_dismissed";--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_goal_date_key" ON "progress_snapshots" USING btree ("goal_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "snapshots_goal_date_idx" ON "progress_snapshots" USING btree ("goal_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "coach_messages_thread_idx" ON "coach_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_threads_user_idx" ON "coach_threads" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "ai_calls_user_time_idx" ON "ai_calls" USING btree ("user_id","created_at");