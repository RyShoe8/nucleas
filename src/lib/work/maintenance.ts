const DAY_MS = 86_400_000;
export const COMPLETED_TARGET_COOLDOWN_MS = 30 * DAY_MS;

type AssessmentDates = {
    checkedAt?: Date | string | null;
    lastObservedAt?: Date | string | null;
    observationError?: string | null;
};

function timestamp(value: Date | string | null | undefined) {
    const ms = value == null ? NaN : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/** The passing assessment starts the cooldown. Failed due checks retry tomorrow. */
export function targetRecheckTime(target: AssessmentDates): number {
    const assessed = timestamp(target.checkedAt);
    const observed = timestamp(target.lastObservedAt);
    return Math.max(
        assessed === null ? 0 : assessed + COMPLETED_TARGET_COOLDOWN_MS,
        target.observationError && observed !== null ? observed + DAY_MS : 0,
    );
}
