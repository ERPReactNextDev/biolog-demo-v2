// app/api/users/search/route.ts
// GET /api/users/search?keyword=<keyword>&excludeRefId=<refId>
// Searches users by Firstname, Lastname, Email, or userName (case-insensitive).
// NEVER import supabase-admin in client components — this is a server-side API route only.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { User } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const keyword = searchParams.get('keyword');
    const excludeRefId = searchParams.get('excludeRefId');

    // Validate: keyword must be present
    if (keyword === null || keyword === undefined) {
      return NextResponse.json(
        { error: 'keyword is required' },
        { status: 400 }
      );
    }

    // Validate: keyword must not be empty after trim
    const trimmedKeyword = keyword.trim();
    if (trimmedKeyword.length === 0) {
      return NextResponse.json(
        { error: 'keyword must contain at least one non-whitespace character' },
        { status: 400 }
      );
    }

    // Validate: keyword must not exceed 200 characters (checked against original value)
    if (keyword.length > 200) {
      return NextResponse.json(
        { error: 'keyword must not exceed 200 characters' },
        { status: 400 }
      );
    }

    // Build the ILIKE pattern
    const pattern = `%${trimmedKeyword}%`;

    // Build query with ILIKE on all four searchable columns
    let query = supabaseAdmin
      .from('users')
      .select('*')
      .or(
        `"Firstname".ilike.${pattern},"Lastname".ilike.${pattern},"Email".ilike.${pattern},"userName".ilike.${pattern}`
      )
      .order('Lastname', { ascending: true })
      .order('Firstname', { ascending: true })
      .limit(20);

    // Exclude the requesting user from results if excludeRefId is provided
    if (excludeRefId && excludeRefId.trim().length > 0) {
      query = query.neq('ReferenceID', excludeRefId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[api/users/search] Supabase error:', error);
      return NextResponse.json(
        { error: 'Search operation failed' },
        { status: 500 }
      );
    }

    return NextResponse.json((data ?? []) as User[], { status: 200 });
  } catch (err) {
    console.error('[api/users/search]', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
