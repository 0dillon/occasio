/**
 * OCCASIO product rules.
 *
 * CONFIRMED = founder decision (agent.md Part I §2 "Confirmed by founder").
 * PROPOSED  = master-plan default; configurable and NOT founder-confirmed.
 * Change a PROPOSED value here (and note it in docs/DECISIONS.md); do not
 * scatter these numbers through the codebase.
 */
export const RULES_VERSION = "2026-11-06.1";

export const productRules = {
  confirmed: {
    exchangeOpportunities: true, // contribute and receive opportunities
    submissionHasLinkAndImageReference: true, // link + image in the intended flow
    verifyExistenceAndOpenness: true,
    autonomousDiscovery: true,
    matchWhatUsersAskFor: true,
    helpApplyBeforeDeadlines: true,
  },
  proposed: {
    /** One accepted new canonical edition earns this many noncash credits. */
    creditsPerAcceptedEdition: 1,
    /** Credits spent per successful match redemption. */
    creditsPerRedemption: 1,
    /** Discovery-generated records never mint user credits. */
    discoveryMintsCredits: false,
    /** One free starter match per verified account (experiment). */
    starterMatchEnabled: true,
    /** Image is optional but fully supported; the application link is required. */
    imageRequired: false,
    /** New submissions per verified user per day. */
    dailySubmissionCap: 5,
    /** Pending (unresolved) submissions allowed at once. */
    maxPendingSubmissions: 3,
    /** Max poster upload in bytes before processing. */
    maxUploadBytes: 8 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    /** A record is too stale to redeem when its last successful check is older than this. */
    redemptionFreshnessHours: 72,
    /** Date-only or unknown-time deadlines inside this window are excluded from credit matching. */
    ambiguousDeadlineExclusionHours: 72,
    /** New organizer domains always went to human review at launch; D11 lets clean AI-checked ones auto-publish. */
    reviewNewOrganizers: false,
    /** Default reminder offsets before a known deadline, in minutes. */
    reminderOffsetsMinutes: [7 * 1440, 3 * 1440, 1440],
    /** Retries for transient notification failures (approx. 30s, 2m, 10m, 30m). */
    notificationRetryDelaysSeconds: [30, 120, 600, 1800],
    /** Ranking weights (hypotheses to evaluate). Eligibility is a gate, not a weight. */
    rankingWeights: { interest: 0.35, goal: 0.25, quality: 0.15, feasibility: 0.15, preference: 0.1 },
    /** Refresh cadence in hours by time remaining. */
    recheckHours: { farOpen: 48, near: 24, closing: 6, rolling: 72, maxBackoff: 24 },
    /** Rejected poster retention. */
    rejectedAssetRetentionDays: 30,
    acceptedAssetReviewDays: 90,
    /**
     * Contributor perks (D13). Reached by credits EARNED from shared
     * opportunities (lifetime), not spent. Thresholds are proposals.
     */
    perkThresholds: { contributorBadge: 1, personalAlerts: 3 },
    /** Credits when someone you invited confirms their email (D14). */
    creditsPerReferral: 1,
    /** Referral awards per referrer per calendar month (abuse limit). */
    maxReferralAwardsPerMonth: 10,
    /**
     * D14: listings publish without a person. When false, a page read by the
     * rule-based parser can publish if every other check is clean.
     */
    autoPublishRequiresAi: false,
    /** A deadline without a stated timezone can publish; it is shown as "timezone not stated". */
    autoPublishAllowsUnknownTimezone: true,
    /** Discovery: pages fetched from a paged source per crawl. */
    discoveryMaxPages: 8,
    /** Saved alert searches per member. */
    maxAlertSearches: 5,
    sessionDays: 30,
    recentAuthMinutes: 15,
  },
} as const;

export type ProductRules = typeof productRules;
