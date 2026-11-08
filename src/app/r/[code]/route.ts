import { NextResponse, type NextRequest } from "next/server";
import { isReferralCode, REFERRAL_COOKIE } from "@/domain/referrals";

/** Invite link: remembers who sent you for 30 days, then opens sign-up. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = NextResponse.redirect(new URL("/auth/sign-up", req.url));
  const c = code.toLowerCase();
  if (isReferralCode(c)) {
    res.cookies.set(REFERRAL_COOKIE, c, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 30 * 86_400, path: "/" });
  }
  return res;
}
