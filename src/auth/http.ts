import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from './validation';
import { inputObject, readBoundedJson } from './player-auth';

export async function readCredentials(
  request: NextRequest,
): Promise<{ nickname: unknown; password: unknown }> {
  if (
    !/^\s*application\/json\s*(;|$)/i.test(
      request.headers.get('content-type') ?? '',
    )
  )
    throw new AuthError('Send the request as JSON.', 415);
  const input = inputObject(await readBoundedJson(request, 4096));
  return {
    nickname: input.nickname ?? input.username,
    password: input.password,
  };
}

export function authErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: { 'cache-control': 'no-store' } },
    );
  }
  return NextResponse.json(
    { error: 'Unable to complete the request.' },
    { status: 500, headers: { 'cache-control': 'no-store' } },
  );
}
