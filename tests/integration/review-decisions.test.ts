import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withStaff } from "@/db/tx";
import { rejectSubmission } from "@/domain/exchange";
import { closePools, ownerQuery, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factory";

async function submission(userId: string) {
  const [s] = await ownerQuery(
    `INSERT INTO submissions(user_id, application_url, normalized_url, idempotency_key, status)
     VALUES ($1,'https://example.org/x','https://example.org/x',$2,'review_required') RETURNING id`,
    [userId, `k-${Math.random()}`],
  );
  return s.id as string;
}

beforeEach(resetDb);
afterAll(closePools);

describe("review decisions", () => {
  it("sends a submission back for more information without resolving it", async () => {
    const member = await makeUser();
    const reviewer = await makeUser({ role: "reviewer" });
    const id = await submission(member.id);
    await withStaff(reviewer.id, "reviewer", (c) =>
      rejectSubmission(c, id, "The link needs to be the organizer's page.", { kind: "staff", id: reviewer.id }, "needs_information", ["working_link"]));
    const [s] = await ownerQuery("SELECT status, missing_information, resolved_at FROM submissions WHERE id = $1", [id]);
    expect(s.status).toBe("needs_information");
    expect(s.missing_information).toEqual(["working_link"]);
    expect(s.resolved_at).toBeNull();
  });

  it("rejects a submission and records when it was resolved", async () => {
    const member = await makeUser();
    const reviewer = await makeUser({ role: "reviewer" });
    const id = await submission(member.id);
    await withStaff(reviewer.id, "reviewer", (c) =>
      rejectSubmission(c, id, "This is not an opportunity listing.", { kind: "staff", id: reviewer.id }, "rejected"));
    const [s] = await ownerQuery("SELECT status, resolved_at FROM submissions WHERE id = $1", [id]);
    expect(s.status).toBe("rejected");
    expect(s.resolved_at).not.toBeNull();
  });
});
