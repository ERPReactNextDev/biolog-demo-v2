// app/api/messages/route.ts
// Handles GET (fetch message history), POST (send message), and PATCH (mark as read)
// for the Biolog Messaging module.
// Uses the service-role Supabase client — server-side ONLY.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// ---------------------------------------------------------------------------
// GET /api/messages?conversationId=<uuid>
// Returns up to 100 non-deleted messages ordered by created_at ASC,
// with a nested sender join.
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    // Validate conversationId
    if (!conversationId || conversationId.trim() === '') {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 }
      );
    }

    // Verify conversation exists
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle();

    if (convError) {
      console.error('[api/messages GET] conversation lookup error:', convError);
      return NextResponse.json(
        { error: 'An unexpected error occurred' },
        { status: 500 }
      );
    }

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Fetch messages without FK join, then manually attach sender
    const { data: rawMessages, error: msgError } = await supabaseAdmin
      .from('messages')
      .select('id, conversation_id, sender_id, message_type, content, is_edited, is_deleted, created_at, updated_at, reply_to_message_id, meta')
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .limit(100);

    if (msgError) {
      console.error('[api/messages GET] messages query error:', msgError);
      return NextResponse.json(
        { error: 'An unexpected error occurred' },
        { status: 500 }
      );
    }

    if (!rawMessages || rawMessages.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    const senderIds = [...new Set(rawMessages.map((m: any) => m.sender_id as string))];
    const { data: senderUsers } = await supabaseAdmin
      .from('users')
      .select('id, "ReferenceID", "Firstname", "Lastname", "Email", "userName", "Role", "Position", "Department", "profilePicture", "ContactNumber", "Status"')
      .in('"ReferenceID"', senderIds);

    const sendersMap = new Map((senderUsers ?? []).map((u: any) => [u.ReferenceID, u]));
    const messages = rawMessages.map((m: any) => ({ ...m, sender: sendersMap.get(m.sender_id) ?? null }));

    return NextResponse.json(messages, { status: 200 });
  } catch (err) {
    console.error('[api/messages GET]', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/messages
// Body: { conversationId, senderRefId, content, messageType? }
// Inserts a new message row and returns it with the nested sender.
// The DB trigger trg_new_message_updates_conv handles last_message_at.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { conversationId, senderRefId, content, messageType } = body as {
      conversationId?: string;
      senderRefId?: string;
      content?: string;
      messageType?: string;
    };

    // Validate required fields
    if (!conversationId || typeof conversationId !== 'string' || conversationId.trim() === '') {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 }
      );
    }

    if (!senderRefId || typeof senderRefId !== 'string' || senderRefId.trim() === '') {
      return NextResponse.json(
        { error: 'senderRefId is required' },
        { status: 400 }
      );
    }

    if (!content || typeof content !== 'string' || content.trim() === '') {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    if (content.length > 2000) {
      return NextResponse.json(
        { error: 'content must not exceed 2000 characters' },
        { status: 400 }
      );
    }

    // Insert the message (no FK join — fetch sender separately)
    const { data: insertedRaw, error: insertError } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderRefId,
        message_type: typeof messageType === 'string' && messageType.trim() !== '' ? messageType : 'text',
        content,
        is_edited: false,
        is_deleted: false,
      })
      .select('id, conversation_id, sender_id, message_type, content, is_edited, is_deleted, created_at, updated_at, reply_to_message_id, meta')
      .single();

    if (insertError) {
      console.error('[api/messages POST] insert error:', insertError);
      return NextResponse.json(
        { error: 'An unexpected error occurred' },
        { status: 500 }
      );
    }

    // Attach sender user
    const { data: senderUser } = await supabaseAdmin
      .from('users')
      .select('id, "ReferenceID", "Firstname", "Lastname", "Email", "userName", "Role", "Position", "Department", "profilePicture", "ContactNumber", "Status"')
      .eq('"ReferenceID"', senderRefId)
      .maybeSingle();

    const inserted = { ...insertedRaw, sender: senderUser ?? null };

    return NextResponse.json(inserted, { status: 201 });
  } catch (err) {
    console.error('[api/messages POST]', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/messages
// Body: { conversationId, referenceId }
// Updates last_read_message_id and last_seen_at on the participant record.
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { conversationId, referenceId } = body as {
      conversationId?: string;
      referenceId?: string;
    };

    // Validate required fields
    if (!conversationId || typeof conversationId !== 'string' || conversationId.trim() === '') {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 }
      );
    }

    if (!referenceId || typeof referenceId !== 'string' || referenceId.trim() === '') {
      return NextResponse.json(
        { error: 'referenceId is required' },
        { status: 400 }
      );
    }

    // Find the latest message in this conversation
    const { data: latestMessage, error: latestError } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      console.error('[api/messages PATCH] latest message query error:', latestError);
      return NextResponse.json(
        { error: 'An unexpected error occurred' },
        { status: 500 }
      );
    }

    // Update the participant's read cursor
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('conversation_participants')
      .update({
        last_read_message_id: latestMessage?.id ?? null,
        last_seen_at: new Date().toISOString(),
      })
      .eq('conversation_id', conversationId)
      .eq('user_id', referenceId)
      .select()
      .returns<Record<string, unknown>[]>();

    if (updateError) {
      console.error('[api/messages PATCH] participant update error:', updateError);
      return NextResponse.json(
        { error: 'An unexpected error occurred' },
        { status: 500 }
      );
    }

    // If no rows were updated, the participant record doesn't exist
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'Participant not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(updated[0], { status: 200 });
  } catch (err) {
    console.error('[api/messages PATCH]', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
