import type { Recording } from '../core/types.ts';
import { readApplicationPublication } from './application-publication.ts';

export function readOnboardingRecording(input: unknown, runId: string | undefined): Recording | undefined {
  if (input === undefined) return undefined;
  const recording = readApplicationPublication({ recording: input }).recording;
  if (!recording || (recording.snapshot as { runId?: unknown }).runId !== runId) throw Error('Onboarding evidence belongs to another native run');
  return recording;
}
