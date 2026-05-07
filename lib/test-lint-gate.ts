// Throwaway file to verify the ESLint CI gate (Phase 7 verification).
// This file intentionally violates @typescript-eslint/no-explicit-any.
// It will be deleted after the gate fires red on PR.
export function testLintGate(value: any): any {
  return value
}
