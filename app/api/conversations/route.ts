// app/api/conversations/route.ts
// GET: List conversations for a user
// POST: Get-or-create a direct conversation between two users
// Uses supabaseAdmin (service-role) — server-side only, never imported in client code.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { Conversation } from '@/lib/types';

export const dynamic = 'force-dynamic';

// ─── GET /api/conversations?referenceId=X ──────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const referenceId = searchParams.get('referenceId');

  if (!referenceId || referenceId.trim() === '') {
    return NextResponse.json(
      { error: 'referenceId is required' },
      { status: 400 }
    );
  }

  try {
    // 1. Find all conversation IDs this user participates in
    const { data: participantRows, error: participantError } = await supabaseAdmin
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', referenceId.trim());

    if (participantError) throw participantError;

    if (!participantRows || participantRows.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    const conversationIds = participantRows.map((p) => p.conversation_id);

    // 2. Fetch the conversations ordered by last_message_at DESC
    const { data: conversations, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .in('id', conversationIds)
      .order('last_message_at', { ascending: false });

    if (convError) throw convError;

    if (!conversations || conversations.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // 3. For each conversation fetch participants then look up their user rows manually
    const enriched = await Promise.all(
      conversations.map(async (conv: Conversation) => {
        // Step A: fetch participant rows (no join)
        const { data: participants, error: partError } = await supabaseAdmin
          .from('conversation_participants')
          .select('id, conversation_id, user_id, role, last_read_message_id, last_seen_at')
          .eq('conversation_id', conv.id);

        if (partError) throw partError;
        if (!participants || participants.length === 0) {
          return { ...conv, participants: [] };
        }

        // Step B: fetch user rows for all participant user_ids
        const userIds = participants.map((p: { user_id: string }) => p.user_id);
        const { data: users, error: userError } = await supabaseAdmin
          .from('users')
          .select('id, "ReferenceID", "Firstname", "Lastname", "Email", "userName", "Role", "Position", "Department", "profilePicture", "ContactNumber", "Status"')
          .in('"ReferenceID"', userIds);

        if (userError) throw userError;

        // Step C: merge user into each participant
        const usersMap = new Map((users ?? []).map((u: { ReferenceID: string }) => [u.ReferenceID, u]));
        const enrichedParticipants = participants.map((p: { user_id: string }) => ({
          ...p,
          user: usersMap.get(p.user_id) ?? null,
        }));

        return { ...conv, participants: enrichedParticipants };
      })
    );

    return NextResponse.json(enriched, { status: 200 });
  } catch (err) {
    console.error('[GET /api/conversations]', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

// ─── POST /api/conversations ───────────────────────────────────────────────

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { user1RefId, user2RefId } = body as Record<string, unknown>;

  // Validate user1RefId
  if (!user1RefId || typeof user1RefId !== 'string' || user1RefId.trim() === '') {
    return NextResponse.json(
      { error: 'user1RefId is required and must be a non-empty string' },
      { status: 400 }
    );
  }

  // Validate user2RefId
  if (!user2RefId || typeof user2RefId !== 'string' || user2RefId.trim() === '') {
    return NextResponse.json(
      { error: 'user2RefId is required and must be a non-empty string' },
      { status: 400 }
    );
  }

  const ref1 = user1RefId.trim();
  const ref2 = user2RefId.trim();

  try {
    // 1. Fetch conversation IDs for user1
    const { data: rows1, error: err1 } = await supabaseAdmin
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', ref1);

    if (err1) throw err1;

    // 2. Fetch conversation IDs for user2
    const { data: rows2, error: err2 } = await supabaseAdmin
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', ref2);

    if (err2) throw err2;

    const ids1 = new Set((rows1 ?? []).map((r) => r.conversation_id));
    const ids2 = new Set((rows2 ?? []).map((r) => r.conversation_id));

    // 3. Intersection of both users' conversation IDs
    const sharedIds = [...ids1].filter((id) => ids2.has(id));

    // 4. Filter for direct conversations only
    if (sharedIds.length > 0) {
      const { data: existing, error: existErr } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .in('id', sharedIds)
        .eq('conversation_type', 'direct')
        .limit(1)
        .maybeSingle();

      if (existErr) throw existErr;

      if (existing) {
        return NextResponse.json(existing, { status: 200 });
      }
    }

    // 5. No existing direct conversation — create one
    const { data: newConv, error: insertConvErr } = await supabaseAdmin
      .from('conversations')
      .insert({
        conversation_type: 'direct',
        created_by: ref1,
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertConvErr) throw insertConvErr;

    // 6. Insert two participant rows
    const { error: insertPartErr } = await supabaseAdmin
      .from('conversation_participants')
      .insert([
        { conversation_id: newConv.id, user_id: ref1, role: 'member' },
        { conversation_id: newConv.id, user_id: ref2, role: 'member' },
      ]);

    if (insertPartErr) throw insertPartErr;

    return NextResponse.json(newConv, { status: 201 });
  } catch (err) {
    console.error('[POST /api/conversations]', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
