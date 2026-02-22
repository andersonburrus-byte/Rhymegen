import { NextRequest, NextResponse } from "next/server";
import { findRhymes } from "@/lib/matcher";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let phrase: string;
  let count: number;

  try {
    const body = await req.json();
    phrase = (body.phrase ?? "").trim();
    count = Math.min(200, Math.max(1, parseInt(body.count ?? "50", 10)));
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  if (!phrase) {
    return NextResponse.json(
      { error: "empty_input", message: "Phrase cannot be empty." },
      { status: 400 }
    );
  }

  try {
    const output = findRhymes(phrase, count);
    return NextResponse.json(output);
  } catch (err) {
    console.error("matcher error:", err);
    return NextResponse.json(
      {
        error: "engine_error",
        message: "Something went wrong. Please try again.",
      },
      { status: 500 }
    );
  }
}
