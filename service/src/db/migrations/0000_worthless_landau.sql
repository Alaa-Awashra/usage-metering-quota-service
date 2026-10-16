CREATE TABLE "account_monthly_usage" (
	"account_id" uuid NOT NULL,
	"month" date NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "account_monthly_usage_account_id_month_pk" PRIMARY KEY("account_id","month"),
	CONSTRAINT "account_usage_nonnegative" CHECK ("account_monthly_usage"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "consume_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"units" bigint NOT NULL,
	"accepted" boolean,
	"rejected_rule" varchar(32),
	"rejected_level" varchar(7),
	"rejection_limit" bigint,
	"account_monthly_limit" bigint,
	"account_max_per_request" bigint,
	"user_monthly_limit" bigint,
	"user_max_per_request" bigint,
	"account_used_after" bigint,
	"user_used_after" bigint,
	"month" date,
	"created_at" timestamp with time zone,
	CONSTRAINT "requests_units_check" CHECK ("consume_requests"."units" > 0 AND "consume_requests"."units" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" uuid,
	"scope" varchar(7) NOT NULL,
	"name" varchar(100) NOT NULL,
	"monthly_limit" bigint NOT NULL,
	"max_per_request" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_scope_check" CHECK ("plans"."scope" IN ('account','user')),
	CONSTRAINT "plans_limits_check" CHECK ("plans"."monthly_limit" >= 0 AND "plans"."monthly_limit" <= 9007199254740991 AND "plans"."max_per_request" > 0 AND "plans"."max_per_request" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "user_monthly_usage" (
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_monthly_usage_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "user_usage_nonnegative" CHECK ("user_monthly_usage"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" varchar(100) NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_monthly_usage" ADD CONSTRAINT "account_monthly_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consume_requests" ADD CONSTRAINT "consume_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consume_requests" ADD CONSTRAINT "consume_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_monthly_usage" ADD CONSTRAINT "user_monthly_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "requests_account_request_uq" ON "consume_requests" USING btree ("account_id","request_id");--> statement-breakpoint
CREATE INDEX "requests_account_id_idx" ON "consume_requests" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "requests_user_id_idx" ON "consume_requests" USING btree ("account_id","user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_global_name_uq" ON "plans" USING btree ("scope","name") WHERE "plans"."owner_account_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_owner_name_uq" ON "plans" USING btree ("owner_account_id","scope","name") WHERE "plans"."owner_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_account_external_uq" ON "users" USING btree ("account_id","external_id");
--> statement-breakpoint
ALTER TABLE plans ADD CONSTRAINT plans_owner_account_fk FOREIGN KEY (owner_account_id) REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_id_account_uq UNIQUE (id,account_id);
--> statement-breakpoint
ALTER TABLE consume_requests ADD CONSTRAINT requests_user_account_fk FOREIGN KEY (user_id,account_id) REFERENCES users(id,account_id);
--> statement-breakpoint
CREATE FUNCTION validate_account_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id=NEW.plan_id AND scope='account' AND (owner_account_id IS NULL OR owner_account_id=NEW.id)) THEN
    RAISE EXCEPTION 'invalid account plan assignment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION validate_user_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id=NEW.plan_id AND scope='user' AND (owner_account_id IS NULL OR owner_account_id=NEW.account_id)) THEN
    RAISE EXCEPTION 'invalid user plan assignment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounts_plan_guard BEFORE INSERT OR UPDATE OF plan_id ON accounts FOR EACH ROW EXECUTE FUNCTION validate_account_plan();
--> statement-breakpoint
CREATE TRIGGER users_plan_guard BEFORE INSERT OR UPDATE OF plan_id,account_id ON users FOR EACH ROW EXECUTE FUNCTION validate_user_plan();
--> statement-breakpoint
CREATE FUNCTION guard_plan_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.owner_account_id IS NULL OR NEW.owner_account_id IS DISTINCT FROM OLD.owner_account_id OR NEW.scope<>OLD.scope THEN
    RAISE EXCEPTION 'plan identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER plans_identity_guard BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION guard_plan_identity();
