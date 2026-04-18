-- ============ ENUMS ============
create type public.app_role as enum ('admin', 'user');
create type public.wallet_currency as enum ('KES', 'NGN', 'USD', 'EUR', 'GBP');
create type public.transaction_type as enum ('transfer_in', 'transfer_out', 'deposit', 'withdrawal', 'exchange');
create type public.transaction_status as enum ('pending', 'completed', 'failed');

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone_number text,
  kyc_status text not null default 'pending',
  kyc_tier text not null default 'tier1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Users view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- ============ USER ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  )
$$;

create policy "Users view own roles" on public.user_roles
  for select using (auth.uid() = user_id);
create policy "Admins view all roles" on public.user_roles
  for select using (public.has_role(auth.uid(), 'admin'));
create policy "Admins manage roles" on public.user_roles
  for all using (public.has_role(auth.uid(), 'admin'));

-- ============ WALLETS ============
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency public.wallet_currency not null,
  balance numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, currency)
);
alter table public.wallets enable row level security;

create policy "Users view own wallets" on public.wallets
  for select using (auth.uid() = user_id);
create policy "Users insert own wallets" on public.wallets
  for insert with check (auth.uid() = user_id);
create policy "Admins view all wallets" on public.wallets
  for select using (public.has_role(auth.uid(), 'admin'));

-- ============ TRANSACTIONS ============
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  counterparty_user_id uuid references auth.users(id) on delete set null,
  type public.transaction_type not null,
  amount numeric(18,2) not null,
  currency public.wallet_currency not null,
  status public.transaction_status not null default 'completed',
  description text,
  created_at timestamptz not null default now()
);
alter table public.transactions enable row level security;

create policy "Users view own transactions" on public.transactions
  for select using (auth.uid() = user_id);
create policy "Admins view all transactions" on public.transactions
  for select using (public.has_role(auth.uid(), 'admin'));

create index idx_transactions_user_created on public.transactions(user_id, created_at desc);

-- ============ TRIGGERS ============
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.handle_updated_at();
create trigger wallets_updated_at before update on public.wallets
  for each row execute function public.handle_updated_at();

-- Auto-create profile + default role + USD wallet on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));

  insert into public.user_roles (user_id, role) values (new.id, 'user');

  insert into public.wallets (user_id, currency, balance) values (new.id, 'USD', 0);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ TRANSFER RPC (atomic wallet-to-wallet) ============
create or replace function public.transfer_funds(
  _to_email text,
  _currency public.wallet_currency,
  _amount numeric,
  _description text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  _from_user uuid := auth.uid();
  _to_user uuid;
  _from_balance numeric;
begin
  if _from_user is null then raise exception 'Not authenticated'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;

  select id into _to_user from public.profiles where email = _to_email;
  if _to_user is null then raise exception 'Recipient not found'; end if;
  if _to_user = _from_user then raise exception 'Cannot transfer to yourself'; end if;

  select balance into _from_balance from public.wallets
    where user_id = _from_user and currency = _currency for update;
  if _from_balance is null then raise exception 'Sender wallet not found'; end if;
  if _from_balance < _amount then raise exception 'Insufficient balance'; end if;

  -- Ensure recipient has wallet
  insert into public.wallets (user_id, currency, balance)
    values (_to_user, _currency, 0)
    on conflict (user_id, currency) do nothing;

  update public.wallets set balance = balance - _amount
    where user_id = _from_user and currency = _currency;
  update public.wallets set balance = balance + _amount
    where user_id = _to_user and currency = _currency;

  insert into public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    values (_from_user, _to_user, 'transfer_out', _amount, _currency, _description);
  insert into public.transactions (user_id, counterparty_user_id, type, amount, currency, description)
    values (_to_user, _from_user, 'transfer_in', _amount, _currency, _description);

  return json_build_object('success', true);
end;
$$;
