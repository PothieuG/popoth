-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.Users (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name character varying NOT NULL,
  email character varying,
  salary numeric,
  password numeric,
  available_menu ARRAY,
  entrees numeric,
  sorties numeric,
  disponible numeric,
  simulation_RAV numeric,
  projection_RAV numeric,
  part_famille numeric,
  ratio numeric,
  current_month numeric,
  personal_groupId numeric,
  family_groupId numeric,
  CONSTRAINT Users_pkey PRIMARY KEY (id)
);
CREATE TABLE public.budget_items (
  id integer NOT NULL DEFAULT nextval('budget_items_id_seq'::regclass),
  group_id integer NOT NULL,
  category_id integer,
  name character varying,
  budget numeric,
  savings numeric,
  percentage numeric,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone,
  isPaid boolean,
  already_paid numeric,
  initial_savings numeric,
  overall_month_budget numeric,
  overall_balance_available numeric,
  user_id bigint NOT NULL DEFAULT '1'::bigint,
  CONSTRAINT budget_items_pkey PRIMARY KEY (id, group_id, user_id),
  CONSTRAINT budget_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT budget_items_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group(id)
);
CREATE TABLE public.categories (
  id integer NOT NULL DEFAULT nextval('categories_id_seq'::regclass),
  name character varying,
  created_at timestamp without time zone,
  updated_at timestamp without time zone,
  CONSTRAINT categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.entrees (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text,
  budget numeric,
  group_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone,
  categorie_libre boolean,
  entree_item_id numeric,
  CONSTRAINT entrees_pkey PRIMARY KEY (id, group_id),
  CONSTRAINT entrees_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group(id)
);
CREATE TABLE public.entrees_items (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text,
  budget real,
  savings real,
  updated_at timestamp without time zone,
  group_id integer NOT NULL,
  isPaid boolean,
  percu numeric,
  CONSTRAINT entrees_items_pkey PRIMARY KEY (id, group_id),
  CONSTRAINT entrees_items_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group(id)
);
CREATE TABLE public.group (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  description text,
  updated_at timestamp without time zone,
  created_by numeric,
  label text,
  disponible numeric,
  isMainMenu boolean,
  url text,
  savings numeric,
  remaining_income numeric,
  user_id numeric,
  budget_available numeric,
  CONSTRAINT group_pkey PRIMARY KEY (id)
);
CREATE TABLE public.group_users (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  group_id bigint NOT NULL,
  user_id bigint NOT NULL,
  share numeric,
  share_percentage numeric,
  income_total_share_percentage numeric,
  CONSTRAINT group_users_pkey PRIMARY KEY (id, group_id, user_id),
  CONSTRAINT group_users_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group(id),
  CONSTRAINT group_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.Users(id)
);
CREATE TABLE public.projet_items (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  group_id integer NOT NULL,
  name character varying,
  budget numeric,
  percentage numeric,
  day_left numeric,
  month_left numeric,
  started_at timestamp without time zone,
  ended_at timestamp without time zone,
  updated_at timestamp without time zone,
  total_restant numeric,
  restant_par_mois numeric,
  isPaid boolean,
  isPaidThisMonth boolean,
  categorie_libre boolean,
  pourcentage_restant numeric,
  amount_paid_this_month numeric,
  CONSTRAINT projet_items_pkey PRIMARY KEY (id, group_id),
  CONSTRAINT projet_items_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group(id)
);
CREATE TABLE public.sorties (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text,
  budget numeric,
  qui numeric,
  group_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone,
  note text,
  categorie_libre boolean,
  CONSTRAINT sorties_pkey PRIMARY KEY (id, group_id),
  CONSTRAINT sorties_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.group(id)
);