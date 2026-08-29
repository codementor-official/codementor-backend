import type { ExerciseContent } from '../domain/model/exercise-content';
import { toLearnerExerciseContent } from './exercise-view';

describe('toLearnerExerciseContent', () => {
  it('removes every grading secret while preserving public examples and starter code', () => {
    const source: ExerciseContent = {
      statement: 'Sum two numbers',
      testCases: [
        { order: 1, input: '1 2', expected: '3', visibility: 'public' },
        { order: 2, input: '40 2', expected: '42', visibility: 'hidden' },
      ],
      languages: [
        {
          id: 'python',
          label: 'Python',
          starterCode: 'def solve(): pass',
          referenceSolution: 'print(sum(map(int, input().split())))',
        },
      ],
      evaluation: {
        checker: 'custom',
        customCheckerCode: 'return actual === expected',
        stopOnFirstFailure: true,
      },
    };

    const result = toLearnerExerciseContent(source);

    expect(result.testCases).toEqual([
      { order: 1, input: '1 2', expected: '3', visibility: 'public' },
    ]);
    expect(result.languages).toEqual([
      { id: 'python', label: 'Python', starterCode: 'def solve(): pass' },
    ]);
    expect(result.evaluation).toEqual({
      checker: 'custom',
      floatTolerance: undefined,
      stopOnFirstFailure: true,
    });
    expect(source.testCases).toHaveLength(2);
    expect(source.languages?.[0]?.referenceSolution).toBeTruthy();
  });
});
