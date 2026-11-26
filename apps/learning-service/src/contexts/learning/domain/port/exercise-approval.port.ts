export const EXERCISE_APPROVAL_PORT = Symbol('EXERCISE_APPROVAL_PORT');

/** Bài code thuộc exercise-service — learning-service không ghi thẳng vào bảng của nó. */
export interface ExerciseApprovalPort {
  /** `authorization` là token của admin đang duyệt; exercise-service tự kiểm vai trò. */
  approve(exerciseId: string, authorization: string): Promise<void>;
}
