import { BusinessRuleViolation, Result } from '@codementor/kernel';
import type { ExerciseKind } from './exercise';

/**
 * Thân bài — khớp 1-1 với validator của collection `exercise_contents`.
 *
 * Collection đang `validationLevel: strict` + `additionalProperties: false`, nên một
 * trường thừa hay sai kiểu là bị MongoDB từ chối. Kiểu ở đây là bản sao của schema đó,
 * không phải mô hình tự do.
 */
export interface TestCase {
  order: number;
  input: string;
  expected: string;
  visibility: 'public' | 'hidden';
  generated?: boolean;
  weight?: number;
}

export interface LanguageConfig {
  id: string;
  label: string;
  monaco?: string;
  starterCode?: string;
  referenceSolution?: string;
}

export interface ExerciseContent {
  statement?: string;
  constraints?: string[];
  hints?: { order: number; text: string; xpPenalty?: number }[];
  examples?: { input: string; output: string; explanation?: string }[];
  testCases?: TestCase[];
  languages?: LanguageConfig[];
  evaluation?: {
    checker?: 'exact' | 'trimmed' | 'float' | 'custom';
    floatTolerance?: number;
    customCheckerCode?: string;
    stopOnFirstFailure?: boolean;
  };
  theory?: { summary?: string; objectives?: string[]; contentHtml?: string };
}

const MIN_TEST_CASES = 3;

/**
 * Điều kiện gửi duyệt, kiểm **tĩnh**.
 *
 * `codementor-content-model.md` §8.3 còn đòi chạy `referenceSolution` qua toàn bộ
 * testcase — việc đó cần sandbox của judge-service, hiện chưa có, nên để Phase 5b.
 * Những gì kiểm được mà không cần chạy code thì kiểm ở đây, vì mỗi lỗi lọt qua là một
 * lần admin phải tự phát hiện bằng tay.
 */
export function validateForSubmission(
  kind: ExerciseKind,
  content: ExerciseContent,
): Result<true, BusinessRuleViolation> {
  const missing: string[] = [];

  if (kind === 'code') {
    if (!content.statement?.trim()) missing.push('đề bài');

    const languages = content.languages ?? [];
    if (languages.length === 0) {
      missing.push('ít nhất một ngôn ngữ');
    } else {
      // Không có lời giải mẫu thì không có gì để đối chiếu khi judge chạy thật ở 5b,
      // và admin cũng không có cách kiểm bài nhanh.
      const withoutSolution = languages
        .filter((language) => !language.referenceSolution?.trim())
        .map((language) => language.label || language.id);
      if (withoutSolution.length > 0) {
        missing.push(`lời giải mẫu cho ${withoutSolution.join(', ')}`);
      }
    }

    const testCases = content.testCases ?? [];
    if (testCases.length < MIN_TEST_CASES) {
      missing.push(`tối thiểu ${MIN_TEST_CASES} test case (đang có ${testCases.length})`);
    }
    // Không có case công khai thì học viên không thấy được ví dụ nào trong workspace.
    if (!testCases.some((testCase) => testCase.visibility === 'public')) {
      missing.push('ít nhất một test case công khai');
    }
  }

  if (kind === 'theory' && !content.theory?.contentHtml?.trim()) {
    missing.push('nội dung bài lý thuyết');
  }

  if (missing.length > 0) {
    return Result.fail(
      new BusinessRuleViolation(`Chưa gửi duyệt được, còn thiếu: ${missing.join('; ')}`, { missing }),
    );
  }
  return Result.ok(true);
}
