import { postUndo } from "../../../src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return postUndo(request);
}
