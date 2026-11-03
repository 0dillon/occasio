export type Outcome = "eligible" | "ineligible" | "unknown";

export type EligibilityRule = {
  rule_type: "residence_country" | "citizenship" | "education_level" | "age_band" | "experience_level" | "other";
  operator: "in" | "not_in" | "note";
  operand: string[];
  source_text: string;
  is_hard: boolean;
};

export type UserEligibility = {
  residence_country: string | null;
  citizenships: string[] | null;
  education_level: string | null;
  age_band: string | null;
  experience_level: string | null;
};

export type RuleResult = { rule: EligibilityRule; outcome: Outcome; reason: string };

const LABEL: Record<EligibilityRule["rule_type"], string> = {
  residence_country: "where you live",
  citizenship: "citizenship",
  education_level: "study level",
  age_band: "age",
  experience_level: "experience",
  other: "other condition",
};

function userValues(rule: EligibilityRule, u: UserEligibility): string[] | null {
  switch (rule.rule_type) {
    case "residence_country": return u.residence_country ? [u.residence_country] : null;
    case "citizenship": return u.citizenships && u.citizenships.length ? u.citizenships : null;
    case "education_level": return u.education_level ? [u.education_level] : null;
    case "age_band": return u.age_band ? [u.age_band] : null;
    case "experience_level": return u.experience_level ? [u.experience_level] : null;
    default: return null;
  }
}

/** Evaluates one rule. Missing user data is "unknown", never "eligible". */
export function evaluateRule(rule: EligibilityRule, u: UserEligibility): RuleResult {
  if (rule.operator === "note" || rule.rule_type === "other") {
    return { rule, outcome: "unknown", reason: `Check with the organizer: ${rule.source_text}` };
  }
  const values = userValues(rule, u);
  if (!values) return { rule, outcome: "unknown", reason: `We don't know your ${LABEL[rule.rule_type]}.` };
  const hit = values.some((v) => rule.operand.includes(v));
  const ok = rule.operator === "in" ? hit : !hit;
  return {
    rule,
    outcome: ok ? "eligible" : "ineligible",
    reason: ok ? `Your ${LABEL[rule.rule_type]} fits: ${rule.source_text}` : `Your ${LABEL[rule.rule_type]} doesn't fit: ${rule.source_text}`,
  };
}

/**
 * Combines rules: any failed hard rule → ineligible; any unknown hard rule →
 * unknown; otherwise eligible. Soft rules only add reasons.
 */
export function evaluate(rules: EligibilityRule[], u: UserEligibility): { outcome: Outcome; results: RuleResult[] } {
  const results = rules.map((r) => evaluateRule(r, u));
  const hard = results.filter((r) => r.rule.is_hard);
  if (hard.some((r) => r.outcome === "ineligible")) return { outcome: "ineligible", results };
  if (hard.some((r) => r.outcome === "unknown")) return { outcome: "unknown", results };
  return { outcome: "eligible", results };
}
