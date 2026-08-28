// lib/supabase-admin.ts
// Service-role Supabase client for server-side API routes ONLY.
// NEVER import this in client components — it uses the secret service role key.
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
