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
  /** stdin/stdout: đầu vào nạp qua stdin. */
  input?: string;
  /** Chế độ hàm: tham số theo VỊ TRÍ, khớp thứ tự `signature.parameters`. */
  args?: unknown[];
  /** Chuỗi ở chế độ stdin; giá trị JSON bất kỳ ở chế độ hàm. */
  expected?: unknown;
  visibility: 'public' | 'hidden';
  generated?: boolean;
  weight?: number;
}

/** Nút của Type IR: `{ kind: 'list', of: { kind: 'float' } }`. */
export type TypeIR = Record<string, unknown>;

export interface FunctionSignature {
  /** snake_case; bộ sinh code đổi sang camelCase cho JS/Java. */
  functionName: string;
  parameters: { name: string; type: TypeIR; description?: string }[];
  returnType: TypeIR;
}

export type IoMode = 'stdin_stdout' | 'function';

export interface LanguageConfig {
  id: string;
  label: string;
  monaco?: string;
  starterCode?: string;
  referenceSolution?: string;
}

export interface ExerciseContent {
  statement?: string;
  /** Vắng mặt = `stdin_stdout`. Bài cũ không mang trường này và không bị migrate. */
  ioMode?: IoMode;
  signature?: FunctionSignature;
  constraints?: string[];
  hints?: { order: number; text: string; xpPenalty?: number }[];
  examples?: { input: string; output: string; explanation?: string }[];
  testCases?: TestCase[];
  languages?: LanguageConfig[];
  evaluation?: {
    checker?: 'exact' | 'trimmed' | 'float' | 'custom' | 'unordered';
    floatTolerance?: number;
    customCheckerCode?: string;
    stopOnFirstFailure?: boolean;
  };
  theory?: { summary?: string; objectives?: string[]; contentHtml?: string };
}

const MIN_TEST_CASES = 3;

const FUNCTION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Từ khoá của Python, JavaScript và Java gộp lại.
 *
 * Tên hàm được sinh ra ở cả ba ngôn ngữ, nên trùng từ khoá của BẤT KỲ ngôn ngữ nào là hỏng —
 * và hỏng ở dạng tệ nhất: lỗi cú pháp trong code hệ thống sinh, không phải trong code học
 * viên. ponytail: chỉ liệt kê từ khoá viết thường (tên hàm buộc snake_case nên chỉ chúng mới
 * đụng được); bổ sung khi có ngôn ngữ thứ tư.
 */
const RESERVED_WORDS = new Set([
  'abstract', 'and', 'as', 'assert', 'async', 'await', 'boolean', 'break', 'byte', 'case',
  'catch', 'char', 'class', 'const', 'continue', 'def', 'default', 'del', 'delete', 'do',
  'double', 'elif', 'else', 'enum', 'except', 'export', 'extends', 'false', 'final', 'finally',
  'float', 'for', 'from', 'function', 'global', 'goto', 'if', 'implements', 'import', 'in',
  'instanceof', 'int', 'interface', 'is', 'lambda', 'let', 'long', 'native', 'new', 'none',
  'nonlocal', 'not', 'null', 'or', 'package', 'pass', 'private', 'protected', 'public',
  'raise', 'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw',
  'throws', 'transient', 'true', 'try', 'typeof', 'var', 'void', 'volatile', 'while', 'with',
  'yield',
]);

/**
 * Kiểm phần riêng của chế độ hàm.
 *
 * Không kiểm `expected` có khớp `returnType` hay không: xác nhận điều đó cho chắc thì phải
 * chạy lời giải mẫu, mà việc đó studio đã làm khi sinh đáp án (nút "Sinh đáp án" gọi thẳng
 * judge). Ở đây chỉ chặn những gì sai chắc chắn mà không cần chạy gì.
 */
function validateFunctionMode(content: ExerciseContent, missing: string[]): void {
  const signature = content.signature;
  if (!signature?.functionName?.trim()) {
    missing.push('chữ ký hàm');
    return;
  }

  const name = signature.functionName.trim();
  if (!FUNCTION_NAME_PATTERN.test(name)) {
    missing.push(`tên hàm "${name}" phải là snake_case (chữ thường, số, gạch dưới)`);
  } else if (RESERVED_WORDS.has(name)) {
    missing.push(`tên hàm "${name}" trùng từ khoá của Python/JavaScript/Java`);
  }

  const parameters = signature.parameters ?? [];
  if (parameters.length === 0) {
    missing.push('ít nhất một tham số');
  }
  const names = parameters.map((parameter) => parameter.name);
  if (new Set(names).size !== names.length) {
    missing.push('tên tham số bị trùng nhau');
  }
  if (!signature.returnType?.kind) {
    missing.push('kiểu trả về');
  }

  // args phải khớp số lượng tham số. Lệch một cái là mọi case đều lỗi khi chạy, và học viên
  // lãnh thay — chặn ở đây rẻ hơn nhiều so với để admin phát hiện.
  const mismatched = (content.testCases ?? [])
    .filter((testCase) => (testCase.args?.length ?? -1) !== parameters.length)
    .map((testCase) => testCase.order);
  if (mismatched.length > 0) {
    missing.push(
      `test case ${mismatched.join(', ')} có số tham số không khớp chữ ký (cần ${parameters.length})`,
    );
  }

  const withoutExpected = (content.testCases ?? [])
    .filter((testCase) => testCase.expected === undefined)
    .map((testCase) => testCase.order);
  if (withoutExpected.length > 0) {
    missing.push(`đáp án cho test case ${withoutExpected.join(', ')}`);
  }
}

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

    if (content.ioMode === 'function') {
      validateFunctionMode(content, missing);
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
